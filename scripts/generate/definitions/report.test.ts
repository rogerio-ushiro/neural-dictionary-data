import { describe, expect, it } from 'vitest'
import type { PublishedGraph } from '../../../src/model/v04/types'
import { buildCoverageReport, formatReport } from './report'

const graph = (): PublishedGraph => ({
  meta: { language: 'it' },
  words: {
    w_0001: { display_form: 'mare', normalized_form: 'mare', pos: null },
    w_0002: { display_form: 'acqua', normalized_form: 'acqua', pos: null },
    w_0003: { display_form: 'riso', normalized_form: 'riso', pos: null },
    w_0004: { display_form: 'riso', normalized_form: 'riso', pos: null },
  },
  expressions: {},
  word_senses: {
    s_0001: { lexeme_id: 'w_0001', lexeme_kind: 'word', concept_id: 'c_0001', is_primary: true },
    s_0002: { lexeme_id: 'w_0002', lexeme_kind: 'word', concept_id: 'c_0002', is_primary: true },
    s_0003: { lexeme_id: 'w_0003', lexeme_kind: 'word', concept_id: 'c_0003', is_primary: true },
    s_0004: { lexeme_id: 'w_0004', lexeme_kind: 'word', concept_id: 'c_0004', is_primary: true },
  },
  concepts: {
    c_0001: { revision: 1, region_id: null, status_fronteira: 'needs_expansion', definition: { text: 'D.', example: 'E.' } },
    c_0002: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' },
    c_0003: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' },
    c_0004: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' },
  },
  associations: [
    { concept_a: 'c_0001', concept_b: 'c_0002', relation_type: 'associata', association_strength: 0.9, confidence: 1, status: 'validated', revision: 1 },
    { concept_a: 'c_0002', concept_b: 'c_0003', relation_type: 'associata', association_strength: 0.8, confidence: 1, status: 'validated', revision: 1 },
    { concept_a: 'c_0002', concept_b: 'c_0004', relation_type: 'associata', association_strength: 0.7, confidence: 1, status: 'validated', revision: 1 },
  ],
  lexical_index: [],
  semantic_regions: {},
  expansion_queue: [],
  sync_state: { manifest_version: null, ready: false },
})

describe('buildCoverageReport', () => {
  it('counts coverage and lists the missing concepts widest-reach first', () => {
    const r = buildCoverageReport(graph())
    expect(r).toMatchObject({ total: 4, withDefinition: 1 })
    expect(r.missing.map((m) => m.concept_id)).toEqual(['c_0002', 'c_0003', 'c_0004'])
    expect(r.missing[0]).toEqual({ concept_id: 'c_0002', lemma: 'acqua', degree: 3 })
  })

  it('flags a normalized_form shared by two concepts', () => {
    const r = buildCoverageReport(graph())
    expect(r.collisions).toEqual([{ normalized_form: 'riso', concept_ids: ['c_0003', 'c_0004'] }])
  })

  it('reports full coverage when every concept has a definition', () => {
    const g = graph()
    for (const c of Object.values(g.concepts)) c.definition = { text: 'D.', example: 'E.' }
    const r = buildCoverageReport(g)
    expect(r.missing).toEqual([])
    expect(formatReport(r)).toContain('_none — full coverage._')
  })
})

describe('formatReport', () => {
  it('renders the percentage and a table row per missing concept', () => {
    const md = formatReport(buildCoverageReport(graph()))
    expect(md).toContain('with definition: **1** (25%)')
    expect(md).toContain('| c_0002 | acqua | 3 |')
    expect(md).toContain('`riso` → c_0003, c_0004')
  })
})
