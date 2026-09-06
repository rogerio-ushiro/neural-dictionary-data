// Sense context for the definition backfill (Epic word-definition-modal, T3.1).
// Per concept it collects the primary lemma plus the concept's *validated*
// associates — enough for the generator to pin which sense of a lemma it is
// writing about ("acqua" the drink, not a homonym), while the definition text
// itself follows rule D2 (function / use), preferring vocabulary outside this
// associate list. React-free; consumes only src/model/v04.

import { buildAdjacencyIndex, buildPrimaryWordIndex } from '../../../src/model/v04/adjacency'
import type { PublishedGraph, Pos } from '../../../src/model/v04/types'

export interface AssociateRef {
  lemma: string
  relation_type: string
  association_strength: number
}

export interface SenseContext {
  concept_id: string
  /** display_form of the concept's primary lexeme; falls back to the raw id. */
  primary_lemma: string
  /** Almost always null in the current seed — kept so the generator can use it
   * when it is present, not relied on. */
  pos: Pos
  region_label: string | null
  /** Every `validated` associate, strongest first (tie: relation_type, lemma). */
  associates: AssociateRef[]
}

export function buildSenseContext(graph: PublishedGraph, conceptId: string): SenseContext {
  const words = buildPrimaryWordIndex(graph)
  const adjacency = buildAdjacencyIndex(graph)
  return contextFrom(graph, conceptId, words, adjacency)
}

/** All concepts, sorted by id — one adjacency/word scan for the whole graph. */
export function buildAllSenseContexts(graph: PublishedGraph): SenseContext[] {
  const words = buildPrimaryWordIndex(graph)
  const adjacency = buildAdjacencyIndex(graph)
  return Object.keys(graph.concepts)
    .sort()
    .map((cid) => contextFrom(graph, cid, words, adjacency))
}

function contextFrom(
  graph: PublishedGraph,
  conceptId: string,
  words: Map<string, string>,
  adjacency: ReturnType<typeof buildAdjacencyIndex>,
): SenseContext {
  const concept = graph.concepts[conceptId]
  if (!concept) throw new Error(`unknown concept id: ${conceptId}`)

  const primaryLemma = words.get(conceptId)
  // No primary sense is spec-legal (validateStructure only warns) — fall back
  // to the raw id, same convention as the UI consumers.
  const pos = primaryLemma ? primaryPos(graph, conceptId) : null

  const regionLabel = concept.region_id ? (graph.semantic_regions[concept.region_id]?.label ?? null) : null

  const associates: AssociateRef[] = (adjacency.get(conceptId) ?? [])
    .map((a) => ({
      lemma: words.get(a.target) ?? a.target,
      relation_type: a.relation_type,
      association_strength: a.association_strength,
    }))
    .sort((x, y) => {
      if (y.association_strength !== x.association_strength) return y.association_strength - x.association_strength
      if (x.relation_type !== y.relation_type) return x.relation_type.localeCompare(y.relation_type)
      return x.lemma.localeCompare(y.lemma, 'it')
    })

  return {
    concept_id: conceptId,
    primary_lemma: primaryLemma ?? conceptId,
    pos,
    region_label: regionLabel,
    associates,
  }
}

function primaryPos(graph: PublishedGraph, conceptId: string): Pos {
  for (const sense of Object.values(graph.word_senses)) {
    if (!sense.is_primary || sense.concept_id !== conceptId) continue
    const lexeme = sense.lexeme_kind === 'word' ? graph.words[sense.lexeme_id] : graph.expressions[sense.lexeme_id]
    return lexeme?.pos ?? null
  }
  return null
}
