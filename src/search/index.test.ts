import { describe, expect, it } from 'vitest'
import type { PublishedGraph } from '../model/v04/types'
import { createSearchIndex, search } from './index'

const graph: PublishedGraph = {
  meta: { language: 'it' },
  words: {
    w_0001: { display_form: 'mare', normalized_form: 'mare', pos: null },
    w_0002: { display_form: 'marea', normalized_form: 'marea', pos: null },
    w_0003: { display_form: 'città', normalized_form: 'citta', pos: null },
    w_0004: { display_form: 'casa', normalized_form: 'casa', pos: null },
  },
  expressions: {},
  word_senses: {
    s_0001: { lexeme_id: 'w_0001', lexeme_kind: 'word', concept_id: 'c_0001', is_primary: true },
    s_0002: { lexeme_id: 'w_0002', lexeme_kind: 'word', concept_id: 'c_0002', is_primary: true },
    s_0003: { lexeme_id: 'w_0003', lexeme_kind: 'word', concept_id: 'c_0003', is_primary: true },
    s_0004: { lexeme_id: 'w_0004', lexeme_kind: 'word', concept_id: 'c_0004', is_primary: true },
  },
  concepts: {
    c_0001: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' },
    c_0002: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' },
    c_0003: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' },
    c_0004: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' },
  },
  associations: [],
  lexical_index: [
    { normalized_form: 'mare', lexeme_id: 'w_0001', lexeme_kind: 'word' },
    { normalized_form: 'marea', lexeme_id: 'w_0002', lexeme_kind: 'word' },
    { normalized_form: 'citta', lexeme_id: 'w_0003', lexeme_kind: 'word' },
    { normalized_form: 'casa', lexeme_id: 'w_0004', lexeme_kind: 'word' },
  ],
  semantic_regions: {},
  expansion_queue: [],
  sync_state: { manifest_version: null, ready: false },
}

describe('search', () => {
  it('matches by prefix, alphabetically (D6 — no relevance ranking)', () => {
    const index = createSearchIndex(graph)
    expect(search(index, 'ma').map((e) => e.lemma)).toEqual(['mare', 'marea'])
  })

  it('is accent- and case-insensitive', () => {
    const index = createSearchIndex(graph)
    expect(search(index, 'CITTA').map((e) => e.lemma)).toEqual(['città'])
    expect(search(index, 'città').map((e) => e.lemma)).toEqual(['città'])
  })

  it('returns concept ids, not lexeme ids, so the caller can navigate directly', () => {
    const index = createSearchIndex(graph)
    expect(search(index, 'casa')).toEqual([{ id: 'c_0004', lemma: 'casa' }])
  })

  it('returns nothing for an empty query', () => {
    const index = createSearchIndex(graph)
    expect(search(index, '   ')).toEqual([])
  })

  it('shrinks as the query grows (prefix narrowing)', () => {
    const index = createSearchIndex(graph)
    const wide = search(index, 'm')
    const narrow = search(index, 'mare')
    expect(narrow.length).toBeLessThanOrEqual(wide.length)
    expect(narrow.every((e) => wide.some((w) => w.id === e.id))).toBe(true)
  })

  it('respects the limit', () => {
    const index = createSearchIndex(graph)
    expect(search(index, 'ma', 1)).toHaveLength(1)
  })
})
