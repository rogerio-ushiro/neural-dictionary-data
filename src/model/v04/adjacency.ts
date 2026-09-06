// In-memory indexes derived from a PublishedGraph at load time (Story 3,
// T3.1). Nothing here is persisted. Shared by the search box and the graph
// adapter. React-free.

import { TOP_N } from './config'
import type { AdjacencyIndex, ConceptAssociation, PublishedGraph } from './types'

export interface SearchEntry {
  /** Concept id — what the app actually navigates to. */
  id: string
  /** display_form of the entry's primary lexeme, shown in the UI. */
  lemma: string
}

/** concept id -> display_form of its primary word/expression. */
export function buildPrimaryWordIndex(graph: PublishedGraph): Map<string, string> {
  const index = new Map<string, string>()
  for (const sense of Object.values(graph.word_senses)) {
    if (!sense.is_primary) continue
    const lexeme = sense.lexeme_kind === 'word' ? graph.words[sense.lexeme_id] : graph.expressions[sense.lexeme_id]
    if (lexeme) index.set(sense.concept_id, lexeme.display_form)
  }
  return index
}

/**
 * Expand each symmetric association into both directions, keyed by concept
 * id. Only `validated` associations are shown to the end user — `candidate`
 * is unreviewed, `rejected`/`deprecated` are retired. Concepts with no
 * validated association still get an empty entry.
 */
export function buildAdjacencyIndex(graph: PublishedGraph): AdjacencyIndex {
  const index: AdjacencyIndex = new Map()
  for (const id of Object.keys(graph.concepts)) index.set(id, [])

  for (const a of graph.associations) {
    if (a.status !== 'validated') continue
    const toEntry = (target: string): ConceptAssociation => ({
      target,
      relation_type: a.relation_type,
      association_strength: a.association_strength,
      confidence: a.confidence,
      status: a.status,
    })
    index.get(a.concept_a)?.push(toEntry(a.concept_b))
    index.get(a.concept_b)?.push(toEntry(a.concept_a))
  }
  return index
}

/**
 * The associates the graph actually shows for `conceptId`: sorted by
 * `association_strength` desc, tie-broken by `relation_type` then
 * alphabetically by the target's display_form (determinism the closure
 * invariant, T1.4, depends on), capped at TOP_N.
 *
 * The data model allows 2+ associations between the same pair of concepts,
 * one per `relation_type` (D2) — but the viz shows one node per associated
 * concept, never one per relation_type. Collapse to the strongest edge per
 * target *before* sorting/slicing, otherwise two edges to the same target
 * both landing in the top N make `egoView` emit two nodes with the same id,
 * which crashes graphology's `addNode` (and the whole React tree with it).
 */
export function topNAssociates(
  conceptId: string,
  index: AdjacencyIndex,
  words: Map<string, string>,
): ConceptAssociation[] {
  const all = index.get(conceptId) ?? []
  const bestByTarget = new Map<string, ConceptAssociation>()
  for (const a of all) {
    const current = bestByTarget.get(a.target)
    if (!current || a.association_strength > current.association_strength) bestByTarget.set(a.target, a)
  }

  return [...bestByTarget.values()]
    .sort((x, y) => {
      if (y.association_strength !== x.association_strength) return y.association_strength - x.association_strength
      if (x.relation_type !== y.relation_type) return x.relation_type.localeCompare(y.relation_type)
      return (words.get(x.target) ?? x.target).localeCompare(words.get(y.target) ?? y.target, 'it')
    })
    .slice(0, TOP_N)
}

/**
 * `buildAdjacencyIndex`/`buildPrimaryWordIndex` scan every association/sense in
 * the graph — expensive to redo on every navigation. Build once per `data`
 * (App.tsx memoizes on `[data]`) and thread it into `egoView`/`topNAssociates`
 * instead of rebuilding per click.
 */
export interface GraphIndex {
  words: Map<string, string>
  adjacency: AdjacencyIndex
}

export function buildGraphIndex(graph: PublishedGraph): GraphIndex {
  return { words: buildPrimaryWordIndex(graph), adjacency: buildAdjacencyIndex(graph) }
}

/** Sorted `{id: conceptId, lemma: display_form}` list backing the autocomplete
 * (D6: alphabetical, `search/index.ts` filters it by prefix). Resolves every
 * `lexical_index` entry (word or expression) through its primary sense. */
export function buildSearchIndex(graph: PublishedGraph): SearchEntry[] {
  const conceptByLexeme = new Map<string, string>() // "kind:id" -> concept id
  for (const sense of Object.values(graph.word_senses)) {
    if (sense.is_primary) conceptByLexeme.set(`${sense.lexeme_kind}:${sense.lexeme_id}`, sense.concept_id)
  }

  const entries: SearchEntry[] = []
  for (const entry of graph.lexical_index) {
    const conceptId = conceptByLexeme.get(`${entry.lexeme_kind}:${entry.lexeme_id}`)
    if (!conceptId) continue
    const lexeme = entry.lexeme_kind === 'word' ? graph.words[entry.lexeme_id] : graph.expressions[entry.lexeme_id]
    if (!lexeme) continue
    entries.push({ id: conceptId, lemma: lexeme.display_form })
  }
  return entries.sort((x, y) => x.lemma.localeCompare(y.lemma, 'it', { sensitivity: 'base' }))
}
