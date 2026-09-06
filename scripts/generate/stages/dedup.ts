// dedup stage (T5.2, spec §14): resolves each candidate's `lemma` against the
// graph (existing concept, or brand-new), then flags self-loops and
// duplicates — against the graph (D2 canonical `(concept_a, concept_b,
// relation_type)`, **any** status, including `rejected`/`deprecated`) and
// within the whole batch (across all concepts in one runPipeline call, not
// just this one — see `seenInBatch`). Doesn't drop anything itself;
// relevance.ts (next stage) turns the flags into `status: rejected` (D11).
//
// `existsInGraph` must include every status, not just validated/candidate:
// publish.ts persists some rejections (low-confidence, existing target) as
// `status: rejected` rows, and validateStructure's duplicate/self-loop checks
// are unconditional on status — a second row for the same (pair, type), even
// both `rejected`, would still fail validateStructure. So "does this pair+type
// already have a row" has to mean *any* row, full stop.

import { normalizeForm } from '../../../src/model/v04/text'
import type { PublishedGraph } from '../../../src/model/v04/types'
import type { ClassifiedCandidate } from './classify'

export interface ResolvedCandidate extends ClassifiedCandidate {
  /** Resolved concept id, or null if `lemma` names a brand-new word/expression. */
  targetConceptId: string | null
  isSelfLoop: boolean
  isDuplicate: boolean
}

/** Precomputed, reusable across every concept in a batch — building it fresh
 * per concept is O(batch_size · graph_size) for no reason, since `graph`
 * doesn't change within one runPipeline call. */
export interface DedupContext {
  conceptByNormalizedForm: Map<string, string>
  existingPairTypes: Set<string>
}

function canonicalKey(a: string, b: string, relationType: string): string {
  return a < b ? `${a}|${b}|${relationType}` : `${b}|${a}|${relationType}`
}

export function buildDedupContext(graph: PublishedGraph): DedupContext {
  const conceptByLexeme = new Map<string, string>() // "kind:id" -> concept id
  for (const sense of Object.values(graph.word_senses)) {
    if (sense.is_primary) conceptByLexeme.set(`${sense.lexeme_kind}:${sense.lexeme_id}`, sense.concept_id)
  }
  const conceptByNormalizedForm = new Map<string, string>()
  for (const entry of graph.lexical_index) {
    const conceptId = conceptByLexeme.get(`${entry.lexeme_kind}:${entry.lexeme_id}`)
    if (conceptId) conceptByNormalizedForm.set(entry.normalized_form, conceptId)
  }

  const existingPairTypes = new Set<string>()
  for (const a of graph.associations) {
    existingPairTypes.add(canonicalKey(a.concept_a, a.concept_b, a.relation_type))
  }

  return { conceptByNormalizedForm, existingPairTypes }
}

/**
 * `seenInBatch` must be the **same Set instance passed across every
 * `resolveDedup` call in one runPipeline batch** (index.ts creates it once,
 * before the per-concept loop) — otherwise two different source concepts in
 * the same batch can independently propose the same target pair+type (e.g.
 * "mare"→"acqua" from both directions) and both survive, producing two rows
 * for the same canonical key and failing validateStructure at publish time.
 */
export function resolveDedup(
  ctx: DedupContext,
  sourceConceptId: string,
  candidates: ClassifiedCandidate[],
  seenInBatch: Set<string>,
): ResolvedCandidate[] {
  return candidates.map((c) => {
    const normalized = normalizeForm(c.lemma)
    const targetConceptId = ctx.conceptByNormalizedForm.get(normalized) ?? null
    const isSelfLoop = targetConceptId !== null && targetConceptId === sourceConceptId

    // A brand-new lemma has no real id yet — `NEW:<form>` is a stable
    // per-lemma placeholder (same convention gap-loop.ts/publish.ts use), fed
    // through the SAME canonicalKey as a real id. This matters: two different
    // source concepts independently proposing the same new lemma+type are NOT
    // duplicates of each other (e.g. "mare" and "abisso" can both validly
    // contenuto→"conchiglia") — only the (source, target, type) triple as a
    // whole needs to be unique, exactly like for an existing target.
    const key = canonicalKey(sourceConceptId, targetConceptId ?? `NEW:${normalized}`, c.relation_type)
    const isDuplicate = !isSelfLoop && (ctx.existingPairTypes.has(key) || seenInBatch.has(key))
    seenInBatch.add(key)

    return { ...c, targetConceptId, isSelfLoop, isDuplicate }
  })
}
