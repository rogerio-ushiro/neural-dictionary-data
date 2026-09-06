import { describe, expect, it } from 'vitest'
import { buildAdjacencyIndex, buildGraphIndex, buildPrimaryWordIndex, buildSearchIndex, topNAssociates } from './adjacency'
import type { Association, PublishedGraph } from './types'

function assoc(a: string, b: string, overrides: Partial<Association> = {}): Association {
  const [x, y] = a < b ? [a, b] : [b, a]
  return {
    concept_a: x,
    concept_b: y,
    relation_type: 'associata',
    association_strength: 0.5,
    confidence: 1,
    status: 'validated',
    revision: 1,
    ...overrides,
  }
}

const graph: PublishedGraph = {
  meta: { language: 'it' },
  words: {
    w_0001: { display_form: 'mare', normalized_form: 'mare', pos: null },
    w_0002: { display_form: 'oceano', normalized_form: 'oceano', pos: null },
    w_0003: { display_form: 'onda', normalized_form: 'onda', pos: null },
    w_0004: { display_form: 'sale', normalized_form: 'sale', pos: null },
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
  associations: [
    assoc('c_0001', 'c_0002', { association_strength: 0.9 }),
    assoc('c_0001', 'c_0003', { association_strength: 0.6 }),
    assoc('c_0001', 'c_0004', { association_strength: 0.6, status: 'candidate' }), // not shown — unreviewed
  ],
  lexical_index: [
    { normalized_form: 'mare', lexeme_id: 'w_0001', lexeme_kind: 'word' },
    { normalized_form: 'oceano', lexeme_id: 'w_0002', lexeme_kind: 'word' },
    { normalized_form: 'onda', lexeme_id: 'w_0003', lexeme_kind: 'word' },
    { normalized_form: 'sale', lexeme_id: 'w_0004', lexeme_kind: 'word' },
  ],
  semantic_regions: {},
  expansion_queue: [],
  sync_state: { manifest_version: null, ready: false },
}

describe('buildAdjacencyIndex', () => {
  it('expands each association symmetrically', () => {
    const index = buildAdjacencyIndex(graph)
    expect(index.get('c_0001')?.map((a) => a.target).sort()).toEqual(['c_0002', 'c_0003'])
    expect(index.get('c_0002')?.map((a) => a.target)).toEqual(['c_0001'])
  })

  it('excludes non-validated associations (candidate/rejected/deprecated)', () => {
    const index = buildAdjacencyIndex(graph)
    expect(index.get('c_0001')?.some((a) => a.target === 'c_0004')).toBe(false)
    expect(index.get('c_0004')).toEqual([])
  })

  it('gives every concept an entry, even with no validated association', () => {
    const index = buildAdjacencyIndex(graph)
    expect(index.has('c_0004')).toBe(true)
  })
})

describe('topNAssociates', () => {
  it('orders by association_strength desc', () => {
    const words = buildPrimaryWordIndex(graph)
    const index = buildAdjacencyIndex(graph)
    const top = topNAssociates('c_0001', index, words)
    expect(top.map((a) => a.target)).toEqual(['c_0002', 'c_0003']) // 0.9 before 0.6
  })

  it('breaks a strength tie alphabetically by target lemma when relation_type also ties', () => {
    const g: PublishedGraph = { ...graph, associations: [assoc('c_0001', 'c_0002', { association_strength: 0.6 }), assoc('c_0001', 'c_0003', { association_strength: 0.6 })] }
    const words = buildPrimaryWordIndex(g)
    const index = buildAdjacencyIndex(g)
    const top = topNAssociates('c_0001', index, words)
    expect(top.map((a) => a.target)).toEqual(['c_0002', 'c_0003']) // "oceano" < "onda"
  })

  it('breaks a strength tie by relation_type before falling back to lemma', () => {
    const g: PublishedGraph = {
      ...graph,
      associations: [
        assoc('c_0001', 'c_0002', { association_strength: 0.6, relation_type: 'similarità' }),
        assoc('c_0001', 'c_0003', { association_strength: 0.6, relation_type: 'categoria' }),
      ],
    }
    const words = buildPrimaryWordIndex(g)
    const index = buildAdjacencyIndex(g)
    const top = topNAssociates('c_0001', index, words)
    // "categoria" < "similarità" alphabetically, even though "oceano" < "onda" would say otherwise
    expect(top.map((a) => a.target)).toEqual(['c_0003', 'c_0002'])
  })

  it('collapses two relation_types between the same pair into a single associate, keeping the stronger one', () => {
    // Legal per D2: a pair can have >1 association, one per relation_type.
    // topNAssociates must show one node per target concept, not one per edge.
    const g: PublishedGraph = {
      ...graph,
      associations: [
        assoc('c_0001', 'c_0002', { association_strength: 0.65, relation_type: 'associata' }),
        assoc('c_0001', 'c_0002', { association_strength: 0.9, relation_type: 'categoria' }),
      ],
    }
    const words = buildPrimaryWordIndex(g)
    const index = buildAdjacencyIndex(g)
    const top = topNAssociates('c_0001', index, words)
    expect(top).toHaveLength(1)
    expect(top[0]).toMatchObject({ target: 'c_0002', relation_type: 'categoria', association_strength: 0.9 })
  })
})

describe('buildPrimaryWordIndex', () => {
  it('resolves a concept to its primary lexeme display_form', () => {
    expect(buildPrimaryWordIndex(graph).get('c_0001')).toBe('mare')
  })

  it('resolves through an Expression primary sense, not just Word (D5)', () => {
    const g: PublishedGraph = {
      ...graph,
      expressions: { e_0001: { display_form: 'al largo', normalized_form: 'al largo', component_word_ids: [], pos: 'locuzione' } },
      word_senses: { ...graph.word_senses, s_0005: { lexeme_id: 'e_0001', lexeme_kind: 'expression', concept_id: 'c_0005', is_primary: true } },
      concepts: { ...graph.concepts, c_0005: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' } },
    }
    expect(buildPrimaryWordIndex(g).get('c_0005')).toBe('al largo')
  })
})

describe('buildSearchIndex', () => {
  it('resolves every lexical_index entry to its concept id, sorted alphabetically', () => {
    const entries = buildSearchIndex(graph)
    expect(entries.map((e) => e.lemma)).toEqual(['mare', 'oceano', 'onda', 'sale'])
    expect(entries.find((e) => e.lemma === 'mare')?.id).toBe('c_0001')
  })

  it('includes an Expression entry alongside Word entries (D5)', () => {
    const g: PublishedGraph = {
      ...graph,
      expressions: { e_0001: { display_form: 'al largo', normalized_form: 'al largo', component_word_ids: [], pos: 'locuzione' } },
      word_senses: { ...graph.word_senses, s_0005: { lexeme_id: 'e_0001', lexeme_kind: 'expression', concept_id: 'c_0005', is_primary: true } },
      concepts: { ...graph.concepts, c_0005: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' } },
      lexical_index: [...graph.lexical_index, { normalized_form: 'al largo', lexeme_id: 'e_0001', lexeme_kind: 'expression' }],
    }
    const entries = buildSearchIndex(g)
    expect(entries.find((e) => e.lemma === 'al largo')).toEqual({ id: 'c_0005', lemma: 'al largo' })
  })
})

describe('buildGraphIndex', () => {
  it('builds both the word index and the adjacency index from one call', () => {
    const idx = buildGraphIndex(graph)
    expect(idx.words.get('c_0001')).toBe('mare')
    expect(idx.adjacency.get('c_0001')).toBeDefined()
  })
})
