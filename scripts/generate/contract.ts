// The GenerationTask/response contract (T5.1, D12) between `runPipeline` and
// whatever produces candidates for a concept (a file, a subagent — see
// `AssociationSource` in index.ts). Provider-agnostic on purpose (spec §30):
// swapping the source shouldn't touch the pipeline's strategic logic.

import { RELATION_INVESTIGATION_ORDER } from '../../src/model/v04/config'
import type { Association, Pos, PublishedGraph } from '../../src/model/v04/types'

/** What a source (file, subagent) is asked to expand. Assembled by
 * `runPipeline` from the graph — no source builds its own task. */
export interface GenerationTask {
  concept_id: string
  /** display_form of the concept's primary word/expression. */
  word: string
  existing_relations: { relation_type: string; target_word: string; association_strength: number }[]
  covered_relation_types: string[]
  missing_relation_types: string[]
  /** Current region assignment, or null — the source may propose one for the concept itself. */
  region: string | null
}

/**
 * One candidate association returned by a source. `lemma` may name an existing
 * word/expression or a brand-new one — dedup.ts resolves which. `confidence`
 * is optional (D12): classify.ts (the first pipeline stage) fills in
 * DEFAULT_CANDIDATE_CONFIDENCE when omitted, so every later stage sees a real
 * number. `pos`/`region` only matter when `lemma` turns out to be new.
 */
export interface RawCandidate {
  lemma: string
  relation_type: string
  association_strength: number
  confidence?: number
  pos?: Pos
  region?: string
}

/** Any callable that turns a task into candidates — the D15 injection point. */
export type AssociationSource = (task: GenerationTask) => Promise<RawCandidate[]> | RawCandidate[]

/** Precomputed, reusable across every concept in a batch — see buildTaskContext. */
export interface TaskContext {
  /** concept id -> display_form of its primary word/expression. */
  words: Map<string, string>
  /** concept id -> every non-retired association touching it. */
  associationsByConceptId: Map<string, Association[]>
}

function buildPrimaryWordIndex(graph: PublishedGraph): Map<string, string> {
  const index = new Map<string, string>()
  for (const sense of Object.values(graph.word_senses)) {
    if (!sense.is_primary) continue
    const lexeme = sense.lexeme_kind === 'word' ? graph.words[sense.lexeme_id] : graph.expressions[sense.lexeme_id]
    if (lexeme) index.set(sense.concept_id, lexeme.display_form)
  }
  return index
}

function buildAssociationsByConceptId(graph: PublishedGraph): Map<string, Association[]> {
  const index = new Map<string, Association[]>()
  const link = (conceptId: string, a: Association): void => {
    const list = index.get(conceptId)
    if (list) list.push(a)
    else index.set(conceptId, [a])
  }
  for (const a of graph.associations) {
    if (a.status === 'rejected' || a.status === 'deprecated') continue
    link(a.concept_a, a)
    link(a.concept_b, a)
  }
  return index
}

/** Builds the indexes `buildGenerationTask` needs, once per batch — building
 * them fresh per concept (the naive approach) is O(batch_size · graph_size)
 * for no reason, since `graph` doesn't change within one runPipeline call. */
export function buildTaskContext(graph: PublishedGraph): TaskContext {
  return { words: buildPrimaryWordIndex(graph), associationsByConceptId: buildAssociationsByConceptId(graph) }
}

/** Builds one GenerationTask from the current graph state. `existing_relations`
 * and coverage include `candidate` associations too (not just `validated`) so a
 * second run before a merge doesn't re-propose what's already pending review —
 * D9's rich criterion, by contrast, only ever counts `validated` ones. */
export function buildGenerationTask(
  graph: PublishedGraph,
  conceptId: string,
  ctx: TaskContext = buildTaskContext(graph),
): GenerationTask {
  const covered = new Set<string>()
  const existing_relations: GenerationTask['existing_relations'] = []

  for (const a of ctx.associationsByConceptId.get(conceptId) ?? []) {
    const otherId = a.concept_a === conceptId ? a.concept_b : a.concept_a
    existing_relations.push({
      relation_type: a.relation_type,
      target_word: ctx.words.get(otherId) ?? otherId,
      association_strength: a.association_strength,
    })
    if (RELATION_INVESTIGATION_ORDER.includes(a.relation_type)) covered.add(a.relation_type)
  }

  return {
    concept_id: conceptId,
    word: ctx.words.get(conceptId) ?? conceptId,
    existing_relations,
    covered_relation_types: [...covered],
    missing_relation_types: RELATION_INVESTIGATION_ORDER.filter((r) => !covered.has(r)),
    region: graph.concepts[conceptId]?.region_id ?? null,
  }
}
