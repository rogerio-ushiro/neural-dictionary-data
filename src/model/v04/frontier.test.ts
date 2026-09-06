import { describe, expect, it } from 'vitest'
import {
  buildValidatedAdjacency,
  computeExpansionQueue,
  conceptDepth,
  expansionPriority,
  needsExpansion,
  wouldBeExpanded,
} from './frontier'
import type { Association, Concept, PublishedGraph } from './types'

function assoc(a: string, b: string, status: Association['status'] = 'validated'): Association {
  const [x, y] = a < b ? [a, b] : [b, a]
  return {
    concept_a: x,
    concept_b: y,
    relation_type: 'associata',
    association_strength: 0.6,
    confidence: 1,
    status,
    revision: 1,
  }
}

function graphOf(associations: Association[], conceptIds: string[]): PublishedGraph {
  const concepts: Record<string, Concept> = {}
  for (const id of conceptIds) {
    concepts[id] = { revision: 1, region_id: null, status_fronteira: 'needs_expansion' }
  }
  return {
    meta: { language: 'it' },
    words: {},
    expressions: {},
    word_senses: {},
    concepts,
    associations,
    lexical_index: [],
    semantic_regions: {},
    expansion_queue: [],
    sync_state: { manifest_version: null, ready: false },
  }
}

function chain(centre: string, count: number, from = 2): { assocs: Association[]; ids: string[] } {
  const assocs: Association[] = []
  const ids = [centre]
  for (let i = from; i < from + count; i += 1) {
    const id = `c_${String(i).padStart(4, '0')}`
    assocs.push(assoc(centre, id))
    ids.push(id)
  }
  return { assocs, ids }
}

describe('buildValidatedAdjacency', () => {
  function assocTyped(a: string, b: string, relationType: string): Association {
    const [x, y] = a < b ? [a, b] : [b, a]
    return { concept_a: x, concept_b: y, relation_type: relationType, association_strength: 0.7, confidence: 1, status: 'validated', revision: 1 }
  }

  it('counts a pair with two relation_types as one neighbour, but keeps both dimensions', () => {
    // Legal under D2: same pair, two associations, different relation_type.
    const g = graphOf(
      [assocTyped('c_0001', 'c_0002', 'associata'), assocTyped('c_0001', 'c_0002', 'categoria')],
      ['c_0001', 'c_0002'],
    )
    const adj = buildValidatedAdjacency(g)
    expect(adj.degree.get('c_0001')).toBe(1)
    expect(adj.neighbours.get('c_0001')).toEqual(['c_0002'])
    expect(adj.dimensions.get('c_0001')?.has('categoria')).toBe(true)
  })

  it('does not mark a concept expanded via multiplicity alone (4 neighbours, 2 types each ≠ degree 8)', () => {
    const dims = ['categoria', 'costituzione', 'parti', 'contenuto']
    const assocs: Association[] = []
    for (let i = 2; i <= 5; i += 1) {
      assocs.push(assocTyped('c_0001', `c_${String(i).padStart(4, '0')}`, dims[i - 2]))
      assocs.push(assocTyped('c_0001', `c_${String(i).padStart(4, '0')}`, 'similarità'))
    }
    const g = graphOf(assocs, ['c_0001', 'c_0002', 'c_0003', 'c_0004', 'c_0005'])
    expect(buildValidatedAdjacency(g).degree.get('c_0001')).toBe(4)
    expect(wouldBeExpanded(g, 'c_0001')).toBe(false)
  })
})

describe('needsExpansion', () => {
  it('is true for a concept below the validated-associate threshold', () => {
    const g = graphOf([assoc('c_0001', 'c_0002'), assoc('c_0001', 'c_0003')], ['c_0001', 'c_0002', 'c_0003'])
    expect(needsExpansion(g, 'c_0001')).toBe(true)
  })

  it('is false once it has enough validated associates', () => {
    const { assocs, ids } = chain('c_0001', 4)
    expect(needsExpansion(graphOf(assocs, ids), 'c_0001')).toBe(false)
  })

  it('ignores candidate associations', () => {
    const assocs = [
      assoc('c_0001', 'c_0002', 'candidate'),
      assoc('c_0001', 'c_0003', 'candidate'),
      assoc('c_0001', 'c_0004', 'candidate'),
      assoc('c_0001', 'c_0005', 'candidate'),
    ]
    const g = graphOf(assocs, ['c_0001', 'c_0002', 'c_0003', 'c_0004', 'c_0005'])
    expect(needsExpansion(g, 'c_0001')).toBe(true)
  })
})

describe('conceptDepth', () => {
  it('is 0 for a hub', () => {
    const { assocs, ids } = chain('c_0001', 15)
    expect(conceptDepth(graphOf(assocs, ids), 'c_0001')).toBe(0)
  })

  it('grows with distance from the nearest hub', () => {
    // c_0001 is a hub (15 edges). c_0002 is not (degree 2). Tail: c_0002 - c_0101 - c_0102.
    const { assocs, ids } = chain('c_0001', 15)
    assocs.push(assoc('c_0002', 'c_0101'), assoc('c_0101', 'c_0102'))
    ids.push('c_0101', 'c_0102')
    const g = graphOf(assocs, ids)
    expect(conceptDepth(g, 'c_0101')).toBe(2) // c_0101 → c_0002 → c_0001
    expect(conceptDepth(g, 'c_0102')).toBe(3)
  })

  it('saturates at the cap when the graph has no hub', () => {
    const g = graphOf([assoc('c_0001', 'c_0002'), assoc('c_0002', 'c_0003')], ['c_0001', 'c_0002', 'c_0003'])
    expect(conceptDepth(g, 'c_0001')).toBe(12)
  })
})

describe('expansionPriority', () => {
  it('ranks a thin concept above a rich one', () => {
    const { assocs, ids } = chain('c_0001', 19)
    assocs.push(assoc('c_0050', 'c_0051'))
    ids.push('c_0050', 'c_0051')
    const g = graphOf(assocs, ids)
    expect(expansionPriority(g, 'c_0050')).toBeGreaterThan(expansionPriority(g, 'c_0001'))
  })

  it('stays within [0, sum of weights = 1]', () => {
    const g = graphOf([assoc('c_0001', 'c_0002')], ['c_0001', 'c_0002'])
    const p = expansionPriority(g, 'c_0001')
    expect(p).toBeGreaterThanOrEqual(0)
    expect(p).toBeLessThanOrEqual(1)
  })
})

describe('computeExpansionQueue', () => {
  it('is gated on the stored status_fronteira, not the minimal predicate', () => {
    // c_0001 is rich (5 validated — needsExpansion() would say false) but its
    // stored status is still needs_expansion (nothing has flipped it yet).
    const { assocs, ids } = chain('c_0001', 5)
    const g = graphOf(assocs, ids)
    expect(needsExpansion(g, 'c_0001')).toBe(false)
    const queue = computeExpansionQueue(g)
    expect(queue.map((q) => q.concept_id)).toContain('c_0001')
    expect(queue).toHaveLength(6)
  })

  it('excludes a concept once its stored status flips to expanded', () => {
    const { assocs, ids } = chain('c_0001', 5)
    const g = graphOf(assocs, ids)
    g.concepts.c_0001.status_fronteira = 'expanded'
    const queue = computeExpansionQueue(g)
    expect(queue.map((q) => q.concept_id)).not.toContain('c_0001')
    expect(queue.map((q) => q.concept_id).sort()).toEqual(['c_0002', 'c_0003', 'c_0004', 'c_0005', 'c_0006'])
    for (let i = 1; i < queue.length; i += 1) {
      expect(queue[i - 1].expansion_priority).toBeGreaterThanOrEqual(queue[i].expansion_priority)
    }
  })
})

describe('wouldBeExpanded (D9 rich criterion)', () => {
  function assocTyped(a: string, b: string, relationType: string): Association {
    const [x, y] = a < b ? [a, b] : [b, a]
    return { concept_a: x, concept_b: y, relation_type: relationType, association_strength: 0.7, confidence: 1, status: 'validated', revision: 1 }
  }

  it('is false below the minimum degree even with full dimension coverage', () => {
    const dims = ['categoria', 'costituzione', 'parti', 'contenuto', 'fenomeni']
    const assocs = dims.map((d, i) => assocTyped('c_0001', `c_${String(i + 2).padStart(4, '0')}`, d))
    const ids = ['c_0001', ...dims.map((_, i) => `c_${String(i + 2).padStart(4, '0')}`)]
    expect(wouldBeExpanded(graphOf(assocs, ids), 'c_0001')).toBe(false) // degree 5 < EXPANDED_MIN_DEGREE (8)
  })

  it('is false at the minimum degree but too few distinct dimensions', () => {
    const assocs: Association[] = []
    for (let i = 2; i <= 9; i += 1) assocs.push(assocTyped('c_0001', `c_${String(i).padStart(4, '0')}`, 'costituzione'))
    const ids = ['c_0001', ...assocs.map((_, i) => `c_${String(i + 2).padStart(4, '0')}`)]
    expect(wouldBeExpanded(graphOf(assocs, ids), 'c_0001')).toBe(false) // only 1 dimension
  })

  it('is false when categoria specifically is missing, even with enough other dimensions', () => {
    const dims = ['costituzione', 'parti', 'contenuto', 'fenomeni', 'azioni', 'oggetti', 'luoghi', 'cause']
    const assocs = dims.map((d, i) => assocTyped('c_0001', `c_${String(i + 2).padStart(4, '0')}`, d))
    const ids = ['c_0001', ...dims.map((_, i) => `c_${String(i + 2).padStart(4, '0')}`)]
    expect(wouldBeExpanded(graphOf(assocs, ids), 'c_0001')).toBe(false)
  })

  it('is true once degree, dimension count and categoria are all satisfied', () => {
    const dims = ['categoria', 'costituzione', 'parti', 'contenuto', 'fenomeni', 'azioni', 'oggetti', 'luoghi']
    const assocs = dims.map((d, i) => assocTyped('c_0001', `c_${String(i + 2).padStart(4, '0')}`, d))
    const ids = ['c_0001', ...dims.map((_, i) => `c_${String(i + 2).padStart(4, '0')}`)]
    expect(wouldBeExpanded(graphOf(assocs, ids), 'c_0001')).toBe(true)
  })

  it('ignores candidate associations (only validated counts)', () => {
    const dims = ['categoria', 'costituzione', 'parti', 'contenuto', 'fenomeni', 'azioni', 'oggetti', 'luoghi']
    const assocs = dims.map((d, i) => ({ ...assocTyped('c_0001', `c_${String(i + 2).padStart(4, '0')}`, d), status: 'candidate' as const }))
    const ids = ['c_0001', ...dims.map((_, i) => `c_${String(i + 2).padStart(4, '0')}`)]
    expect(wouldBeExpanded(graphOf(assocs, ids), 'c_0001')).toBe(false)
  })
})
