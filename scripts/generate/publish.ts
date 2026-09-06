// publish stage (T5.5, spec §14 "pubblicazione"): merges a batch's surviving
// candidates into `seed ∪ batch` and writes candidate/graph.json.
//
// What gets persisted, and why (see also src/model/v04/validate.ts):
//  - a surviving candidate (status: candidate) is ALWAYS persisted; if its
//    target is a brand-new lemma, the word/expression/concept/sense/
//    lexical_index entries are minted first, then the association.
//  - a rejected candidate is persisted as `status: rejected` ONLY when both
//    ends already exist and the pair+type is genuinely new — i.e. only the
//    low-confidence reason is safe to keep as an audit-trail row.
//  - self-loop and duplicate rejects are NEVER persisted as Association rows:
//    validateStructure's self-loop/duplicate checks are unconditional on
//    status, so writing one would make `seed ∪ batch` fail to validate. They
//    are only counted in the run's report.
//  - a rejected candidate whose target is brand-new is dropped entirely
//    (not minted, not persisted) — nothing else would reference that lexeme,
//    so minting it would just pollute the lexicon with a dead entry.
//
// No 2nd sense is ever created for an *existing* word (Restrição MVP,
// WORD↔CONCEPT 1:1): resolveDedup only ever resolves an existing lemma to its
// one existing primary-sense concept — this module has no "add alternate
// sense" operation at all. Two candidates in the same batch minting the same
// *new* lemma reuse the same freshly-minted concept (first proposal's
// pos/region win) — not a conflict, just one concept referenced twice.

import fs from 'node:fs'
import path from 'node:path'
import { REGIONS } from '../../src/model/v04/config'
import { normalizeForm } from '../../src/model/v04/text'
import { validateStructure } from '../../src/model/v04/validate'
import type { Association, Concept, Expression, PublishedGraph, Word, WordSense } from '../../src/model/v04/types'
import type { EvaluatedCandidate } from './stages/relevance'

export interface PublishOutcome {
  graph: PublishedGraph
  /** per source concept: how many survivors/rejects were written for it. */
  stats: Map<string, { added: number; rejectedPersisted: number; rejectedDropped: number }>
  /** everything dropped entirely (self-loop, duplicate, low-confidence-on-new) — audit log, not in the graph. */
  dropped: { concept_id: string; lemma: string; reason: string }[]
}

function nextIdCounter(graph: PublishedGraph): number {
  let max = 0
  const scan = (keys: string[]): void => {
    for (const k of keys) {
      const m = /_(\d+)$/.exec(k)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
  }
  scan(Object.keys(graph.words))
  scan(Object.keys(graph.expressions))
  scan(Object.keys(graph.concepts))
  scan(Object.keys(graph.word_senses))
  return max + 1
}

function resolveRegionId(region: string | undefined): string | null {
  if (!region) return null
  if (region in REGIONS) return region
  const byLabel = Object.entries(REGIONS).find(([, label]) => label === region)
  return byLabel ? byLabel[0] : null
}

function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

/** Mints (or reuses, within this batch) a word/expression + concept + sense
 * for a brand-new lemma. Mutates `graph` in place. */
function mintLexeme(
  graph: PublishedGraph,
  mintedThisBatch: Map<string, string>, // normalized_form -> conceptId
  counter: { next: number },
  candidate: EvaluatedCandidate,
): string {
  const normalized = normalizeForm(candidate.lemma)
  const existing = mintedThisBatch.get(normalized)
  if (existing) return existing

  const n = String(counter.next).padStart(4, '0')
  counter.next += 1
  const isExpression = /\s/.test(candidate.lemma.trim())
  const conceptId = `c_${n}`
  const senseId = `s_${n}`

  const concept: Concept = { revision: 1, region_id: resolveRegionId(candidate.region), status_fronteira: 'needs_expansion' }
  graph.concepts[conceptId] = concept

  if (isExpression) {
    const expressionId = `e_${n}`
    const componentWordIds = candidate.lemma
      .trim()
      .split(/\s+/)
      .flatMap((token) => {
        const tokenNorm = normalizeForm(token)
        const entry = graph.lexical_index.find((e) => e.lexeme_kind === 'word' && e.normalized_form === tokenNorm)
        return entry ? [entry.lexeme_id] : []
      })
    const expression: Expression = {
      display_form: candidate.lemma.trim(),
      normalized_form: normalized,
      component_word_ids: componentWordIds,
      pos: candidate.pos ?? 'locuzione',
    }
    graph.expressions[expressionId] = expression
    const sense: WordSense = { lexeme_id: expressionId, lexeme_kind: 'expression', concept_id: conceptId, is_primary: true }
    graph.word_senses[senseId] = sense
    graph.lexical_index.push({ normalized_form: normalized, lexeme_id: expressionId, lexeme_kind: 'expression' })
  } else {
    const wordId = `w_${n}`
    const word: Word = { display_form: candidate.lemma.trim(), normalized_form: normalized, pos: candidate.pos ?? null }
    graph.words[wordId] = word
    const sense: WordSense = { lexeme_id: wordId, lexeme_kind: 'word', concept_id: conceptId, is_primary: true }
    graph.word_senses[senseId] = sense
    graph.lexical_index.push({ normalized_form: normalized, lexeme_id: wordId, lexeme_kind: 'word' })
  }

  mintedThisBatch.set(normalized, conceptId)
  return conceptId
}

/** Merges `resultsByConceptId` into a deep copy of `seed`, returning the
 * candidate graph plus per-concept stats and a drop log. Does not touch
 * `status_fronteira` (that's Story 7's merge-time job, over validated data). */
export function publish(seed: PublishedGraph, resultsByConceptId: Map<string, EvaluatedCandidate[]>): PublishOutcome {
  const graph: PublishedGraph = JSON.parse(JSON.stringify(seed))
  const mintedThisBatch = new Map<string, string>()
  const counter = { next: nextIdCounter(graph) }
  const stats = new Map<string, { added: number; rejectedPersisted: number; rejectedDropped: number }>()
  const dropped: PublishOutcome['dropped'] = []

  for (const [sourceConceptId, candidates] of resultsByConceptId) {
    let added = 0
    let rejectedPersisted = 0
    let rejectedDropped = 0

    for (const c of candidates) {
      if (c.status === 'rejected' && (c.rejectReason === 'self-loop' || c.rejectReason === 'duplicate')) {
        dropped.push({ concept_id: sourceConceptId, lemma: c.lemma, reason: c.rejectReason })
        rejectedDropped += 1
        continue
      }
      if (c.status === 'rejected' && c.targetConceptId === null) {
        dropped.push({ concept_id: sourceConceptId, lemma: c.lemma, reason: `${c.rejectReason}-on-new-lexeme` })
        rejectedDropped += 1
        continue
      }

      const targetConceptId = c.targetConceptId ?? mintLexeme(graph, mintedThisBatch, counter, c)
      const [concept_a, concept_b] = canonicalPair(sourceConceptId, targetConceptId)
      const association: Association = {
        concept_a,
        concept_b,
        relation_type: c.relation_type,
        direction_hint: 'symmetric',
        association_strength: c.association_strength,
        confidence: c.confidence ?? 0,
        status: c.status,
        revision: 1,
      }
      graph.associations.push(association)
      if (c.status === 'candidate') added += 1
      else rejectedPersisted += 1
    }

    stats.set(sourceConceptId, { added, rejectedPersisted, rejectedDropped })
  }

  return { graph, stats, dropped }
}

export function writeCandidateGraph(outcome: PublishOutcome, outPath: string): void {
  const result = validateStructure(outcome.graph)
  if (!result.ok) {
    throw new Error(`publish produced an invalid graph:\n${result.issues.map((i) => `  [${i.kind}] ${i.detail}`).join('\n')}`)
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(outcome.graph, null, 2)}\n`)
}
