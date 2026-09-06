import { describe, expect, it } from 'vitest'
import { buildGenerationTask } from './contract'
import type { PublishedGraph } from '../../src/model/v04/types'

const graph: PublishedGraph = {
  meta: { language: 'it' },
  words: {
    w_0001: { display_form: 'mare', normalized_form: 'mare', pos: null },
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
    c_0001: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' },
    c_0002: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' },
    c_0003: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' },
  },
  associations: [
    { concept_a: 'c_0001', concept_b: 'c_0002', relation_type: 'costituzione', association_strength: 0.9, confidence: 1, status: 'validated', revision: 1 },
    { concept_a: 'c_0001', concept_b: 'c_0003', relation_type: 'fenomeni', association_strength: 0.6, confidence: 1, status: 'candidate', revision: 1 },
  ],
  lexical_index: [],
  semantic_regions: {},
  expansion_queue: [],
  sync_state: { manifest_version: null, ready: false },
}

describe('buildGenerationTask', () => {
  it('resolves the primary word and current region', () => {
    const task = buildGenerationTask(graph, 'c_0001')
    expect(task.word).toBe('mare')
    expect(task.concept_id).toBe('c_0001')
    expect(task.region).toBeNull()
  })

  it('includes both validated and candidate associations in existing_relations', () => {
    const task = buildGenerationTask(graph, 'c_0001')
    expect(task.existing_relations).toHaveLength(2)
    expect(task.existing_relations.map((r) => r.target_word).sort()).toEqual(['acqua', 'onda'])
  })

  it('splits covered vs missing relation_types by the §7 dimensions actually present', () => {
    const task = buildGenerationTask(graph, 'c_0001')
    expect(task.covered_relation_types.sort()).toEqual(['costituzione', 'fenomeni'])
    expect(task.missing_relation_types).not.toContain('costituzione')
    expect(task.missing_relation_types).toContain('categoria')
  })

  it('a concept with no associations has everything missing', () => {
    const task = buildGenerationTask(graph, 'c_0002')
    // c_0002 does have costituzione via c_0001<->c_0002 (symmetric)
    expect(task.covered_relation_types).toContain('costituzione')
  })
})
