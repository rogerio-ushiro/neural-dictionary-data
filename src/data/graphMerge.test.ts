import { describe, expect, it } from 'vitest'
import { mergeGraph } from './graphMerge'
import type { Association } from '../model/v04/types'
import type { GraphShard } from '../model/v04/wire'

function assoc(a: string, b: string): Association {
  const [x, y] = a < b ? [a, b] : [b, a]
  return { concept_a: x, concept_b: y, relation_type: 'associata', association_strength: 0.5, confidence: 1, status: 'validated', revision: 1 }
}

function shard(id: string, concepts: string[], associations: Association[]): GraphShard {
  return {
    shard: id,
    concepts: Object.fromEntries(concepts.map((c) => [c, { revision: 1, region_id: null, status_fronteira: 'needs_expansion' as const }])),
    associations,
    word_senses: {},
    words: {},
    expressions: {},
  }
}

const global = {
  meta: { language: 'it' as const },
  semantic_regions: { r_natura: { label: 'natura' } },
  expansion_queue: [],
  sync_state: { manifest_version: 1, ready: false },
}

describe('mergeGraph', () => {
  it('merges concepts from every shard', () => {
    const g = mergeGraph({ global, shards: [shard('00', ['c_0001'], []), shard('01', ['c_0002'], [])], lexiconPacks: [] })
    expect(Object.keys(g.concepts).sort()).toEqual(['c_0001', 'c_0002'])
  })

  it('deduplicates a cross-shard association (present in both shard bundles)', () => {
    const a = assoc('c_0001', 'c_0002')
    const g = mergeGraph({
      global,
      shards: [shard('00', ['c_0001'], [a]), shard('01', ['c_0002'], [a])],
      lexiconPacks: [],
    })
    expect(g.associations).toHaveLength(1)
  })

  it('keeps a same-shard association once (not duplicated to begin with)', () => {
    const a = assoc('c_0001', 'c_0002')
    const g = mergeGraph({ global, shards: [shard('00', ['c_0001', 'c_0002'], [a])], lexiconPacks: [] })
    expect(g.associations).toHaveLength(1)
  })

  it('merges lexicon packs into lexical_index', () => {
    const g = mergeGraph({
      global,
      shards: [],
      lexiconPacks: [
        { prefix: 'ma', entries: [{ normalized_form: 'mare', lexeme_id: 'w_0001', lexeme_kind: 'word', display_form: 'mare' }] },
        { prefix: 'ac', entries: [{ normalized_form: 'acqua', lexeme_id: 'w_0002', lexeme_kind: 'word', display_form: 'acqua' }] },
      ],
    })
    expect(g.lexical_index).toHaveLength(2)
    expect(g.lexical_index.map((e) => e.normalized_form).sort()).toEqual(['acqua', 'mare'])
  })

  it('carries the global pack entities through untouched', () => {
    const g = mergeGraph({ global, shards: [], lexiconPacks: [] })
    expect(g.semantic_regions).toEqual(global.semantic_regions)
    expect(g.meta).toEqual(global.meta)
  })
})
