import { describe, expect, it } from 'vitest'
import type { Association, PublishedGraph } from '../../../src/model/v04/types'
import { buildBackfillOrder, pilotSample } from './order'

// Build a graph from an edge list; every endpoint becomes a concept with a
// trivial primary sense so the shape is valid enough for the order helpers
// (which only read `concepts` + validated `associations`).
function graphFromEdges(edges: [string, string][], extraConcepts: string[] = []): PublishedGraph {
  const ids = new Set<string>(extraConcepts)
  for (const [a, b] of edges) {
    ids.add(a)
    ids.add(b)
  }
  const concepts: PublishedGraph['concepts'] = {}
  for (const id of ids) concepts[id] = { revision: 1, region_id: null, status_fronteira: 'needs_expansion' }
  const associations: Association[] = edges.map(([a, b]) => {
    const [ca, cb] = a < b ? [a, b] : [b, a]
    return { concept_a: ca, concept_b: cb, relation_type: 'associata', association_strength: 0.5, confidence: 1, status: 'validated', revision: 1 }
  })
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

// A hub (c_0001) with 5 leaves, a second hub (c_0002) linked to it with 3
// leaves, plus a detached 3-node island.
const edges: [string, string][] = [
  ['c_0001', 'c_0002'],
  ['c_0001', 'c_0010'],
  ['c_0001', 'c_0011'],
  ['c_0001', 'c_0012'],
  ['c_0001', 'c_0013'],
  ['c_0001', 'c_0014'],
  ['c_0002', 'c_0020'],
  ['c_0002', 'c_0021'],
  ['c_0002', 'c_0022'],
  ['c_0090', 'c_0091'],
  ['c_0091', 'c_0092'],
]

describe('buildBackfillOrder', () => {
  it('returns every concept id exactly once', () => {
    const g = graphFromEdges(edges)
    const order = buildBackfillOrder(g)
    expect(order.slice().sort()).toEqual(Object.keys(g.concepts).sort())
    expect(new Set(order).size).toBe(order.length)
  })

  it('is deterministic', () => {
    const g = graphFromEdges(edges)
    expect(buildBackfillOrder(g)).toEqual(buildBackfillOrder(graphFromEdges(edges)))
  })

  it('starts at the global highest-degree concept', () => {
    const order = buildBackfillOrder(graphFromEdges(edges))
    expect(order[0]).toBe('c_0001') // degree 6
  })

  it('is a connected walk — every concept has an earlier neighbour (per component root aside)', () => {
    const g = graphFromEdges(edges)
    const adj = new Map<string, Set<string>>()
    for (const id of Object.keys(g.concepts)) adj.set(id, new Set())
    for (const a of g.associations) {
      adj.get(a.concept_a)?.add(a.concept_b)
      adj.get(a.concept_b)?.add(a.concept_a)
    }
    const order = buildBackfillOrder(g)
    const seen = new Set<string>()
    const roots = new Set<string>()
    // component roots: first time we reach a node in a not-yet-touched component
    for (const id of order) {
      const hasEarlierNeighbour = [...(adj.get(id) as Set<string>)].some((n) => seen.has(n))
      if (!hasEarlierNeighbour) {
        // allowed only if this is the first node of its component
        const compTouched = [...(adj.get(id) as Set<string>)].some((n) => seen.has(n) || roots.has(n))
        expect(compTouched).toBe(false)
        roots.add(id)
      }
      seen.add(id)
    }
    // exactly one root per component (2 components in this fixture)
    expect(roots.size).toBe(2)
  })

  it('sprinkles the small island through the run, not only at the end', () => {
    const order = buildBackfillOrder(graphFromEdges(edges))
    const island = new Set(['c_0090', 'c_0091', 'c_0092'])
    const firstIslandIdx = order.findIndex((id) => island.has(id))
    // 14 concepts total; the island must start before the last third
    expect(firstIslandIdx).toBeLessThan(9)
  })
})

describe('pilotSample', () => {
  it('picks n evenly spaced ids including the first', () => {
    const order = Array.from({ length: 100 }, (_, i) => `c_${String(i).padStart(4, '0')}`)
    const sample = pilotSample(order, 10)
    expect(sample).toHaveLength(10)
    expect(sample[0]).toBe(order[0])
    expect(new Set(sample).size).toBe(10)
    // roughly evenly spaced
    const idxs = sample.map((id) => order.indexOf(id))
    for (let i = 1; i < idxs.length; i += 1) expect(idxs[i] - idxs[i - 1]).toBe(10)
  })

  it('returns the whole order when n >= length, [] when n <= 0', () => {
    const order = ['a', 'b', 'c']
    expect(pilotSample(order, 5)).toEqual(order)
    expect(pilotSample(order, 0)).toEqual([])
  })
})
