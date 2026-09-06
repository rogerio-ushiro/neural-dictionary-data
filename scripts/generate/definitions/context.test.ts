import { describe, expect, it } from 'vitest'
import type { PublishedGraph } from '../../../src/model/v04/types'
import { buildAllSenseContexts, buildSenseContext } from './context'

const graph: PublishedGraph = {
  meta: { language: 'it' },
  words: {
    w_0001: { display_form: 'mare', normalized_form: 'mare', pos: 'sostantivo' },
    w_0002: { display_form: 'acqua', normalized_form: 'acqua', pos: null },
    w_0003: { display_form: 'onda', normalized_form: 'onda', pos: null },
  },
  expressions: {},
  word_senses: {
    s_0001: { lexeme_id: 'w_0001', lexeme_kind: 'word', concept_id: 'c_0001', is_primary: true },
    s_0002: { lexeme_id: 'w_0002', lexeme_kind: 'word', concept_id: 'c_0002', is_primary: true },
    s_0003: { lexeme_id: 'w_0003', lexeme_kind: 'word', concept_id: 'c_0003', is_primary: true },
  },
  concepts: {
    c_0001: { revision: 1, region_id: 'r_natura', status_fronteira: 'needs_expansion' },
    c_0002: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' },
    c_0003: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' },
  },
  associations: [
    { concept_a: 'c_0001', concept_b: 'c_0002', relation_type: 'associata', association_strength: 0.9, confidence: 1, status: 'validated', revision: 1 },
    { concept_a: 'c_0001', concept_b: 'c_0003', relation_type: 'costituzione', association_strength: 0.6, confidence: 1, status: 'validated', revision: 1 },
    { concept_a: 'c_0002', concept_b: 'c_0003', relation_type: 'associata', association_strength: 0.5, confidence: 1, status: 'candidate', revision: 1 },
  ],
  lexical_index: [
    { normalized_form: 'mare', lexeme_id: 'w_0001', lexeme_kind: 'word' },
    { normalized_form: 'acqua', lexeme_id: 'w_0002', lexeme_kind: 'word' },
    { normalized_form: 'onda', lexeme_id: 'w_0003', lexeme_kind: 'word' },
  ],
  semantic_regions: { r_natura: { label: 'natura' } },
  expansion_queue: [],
  sync_state: { manifest_version: null, ready: false },
}

describe('buildSenseContext', () => {
  it('collects lemma, pos, region label and validated associates strongest first', () => {
    const ctx = buildSenseContext(graph, 'c_0001')
    expect(ctx).toMatchObject({ concept_id: 'c_0001', primary_lemma: 'mare', pos: 'sostantivo', region_label: 'natura' })
    expect(ctx.associates).toEqual([
      { lemma: 'acqua', relation_type: 'associata', association_strength: 0.9 },
      { lemma: 'onda', relation_type: 'costituzione', association_strength: 0.6 },
    ])
  })

  it('excludes candidate associations', () => {
    const ctx = buildSenseContext(graph, 'c_0002')
    expect(ctx.associates.map((a) => a.lemma)).toEqual(['mare']) // c_0003 link is candidate
  })

  it('tolerates a null pos and null region', () => {
    const ctx = buildSenseContext(graph, 'c_0002')
    expect(ctx.pos).toBeNull()
    expect(ctx.region_label).toBeNull()
  })

  it('throws on an unknown concept id', () => {
    expect(() => buildSenseContext(graph, 'c_9999')).toThrow(/unknown concept id/)
  })
})

describe('buildAllSenseContexts', () => {
  it('returns one context per concept, sorted by id', () => {
    const all = buildAllSenseContexts(graph)
    expect(all.map((c) => c.concept_id)).toEqual(['c_0001', 'c_0002', 'c_0003'])
  })
})
