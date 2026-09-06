import { describe, expect, it } from 'vitest'
import { TOP_N } from '../model/v04/config'
import type { Association, PublishedGraph } from '../model/v04/types'
import { egoView } from './egoGraph'

function assoc(a: string, b: string, strength: number): Association {
  const [x, y] = a < b ? [a, b] : [b, a]
  return { concept_a: x, concept_b: y, relation_type: 'associata', association_strength: strength, confidence: 1, status: 'validated', revision: 1 }
}

function graphOf(words: Record<string, string>, associations: Association[]): PublishedGraph {
  const wordEntries: PublishedGraph['words'] = {}
  const wordSenses: PublishedGraph['word_senses'] = {}
  const concepts: PublishedGraph['concepts'] = {}
  for (const [wid, lemma] of Object.entries(words)) {
    const n = wid.replace(/^w_/, '')
    wordEntries[wid] = { display_form: lemma, normalized_form: lemma, pos: null }
    wordSenses[`s_${n}`] = { lexeme_id: wid, lexeme_kind: 'word', concept_id: `c_${n}`, is_primary: true }
    concepts[`c_${n}`] = { revision: 1, region_id: null, status_fronteira: 'needs_expansion' }
  }
  return {
    meta: { language: 'it' },
    words: wordEntries,
    expressions: {},
    word_senses: wordSenses,
    concepts,
    associations,
    lexical_index: [],
    semantic_regions: {},
    expansion_queue: [],
    sync_state: { manifest_version: null, ready: false },
  }
}

const graph = graphOf(
  { w_0001: 'mare', w_0002: 'oceano', w_0003: 'onda', w_0004: 'sale' },
  [assoc('c_0001', 'c_0002', 0.9), assoc('c_0001', 'c_0003', 0.6), assoc('c_0001', 'c_0004', 0.3)],
)

describe('egoView', () => {
  it('emits the centre plus one node and one edge per shown associate', () => {
    const { nodes, edges } = egoView(graph, 'c_0001')
    expect(nodes).toHaveLength(4)
    expect(edges).toHaveLength(3)
    expect(nodes[0].kind).toBe('center')
    expect(edges.every((e) => e.source === 'c_0001')).toBe(true)
  })

  it('places stronger associations on tighter rings around the centre', () => {
    const byId = new Map(egoView(graph, 'c_0001').nodes.map((n) => [n.id, n]))
    const c = byId.get('c_0001')!
    const dist = (id: string) => {
      const n = byId.get(id)!
      return Math.hypot(n.x - c.x, n.y - c.y)
    }
    expect(dist('c_0002')).toBeLessThan(dist('c_0003')) // 0.9 closer than 0.6
    expect(dist('c_0003')).toBeLessThan(dist('c_0004')) // 0.6 closer than 0.3
  })

  it('centres the layout on the bounding-box centre', () => {
    const nodes = egoView(graph, 'c_0001').nodes
    const xs = nodes.map((n) => n.x)
    const ys = nodes.map((n) => n.y)
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0, 6)
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(0, 6)
  })

  it('never shows more than TOP_N associates', () => {
    const words = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`w_${String(i + 1).padStart(4, '0')}`, `p${i}`]))
    const associations = Array.from({ length: 13 }, (_, i) => assoc('c_0001', `c_${String(i + 2).padStart(4, '0')}`, 0.5))
    const many = graphOf(words, associations)
    const shown = egoView(many, 'c_0001').nodes.filter((n) => n.kind === 'assoc')
    expect(shown).toHaveLength(TOP_N)
  })

  it('excludes candidate/rejected associations from the view', () => {
    const g = graphOf(
      { w_0001: 'mare', w_0002: 'oceano' },
      [{ ...assoc('c_0001', 'c_0002', 0.9), status: 'candidate' }],
    )
    const shown = egoView(g, 'c_0001').nodes.filter((n) => n.kind === 'assoc')
    expect(shown).toHaveLength(0)
  })

  it('throws for a concept id absent from graph.concepts', () => {
    expect(() => egoView(graph, 'c_9999')).toThrow()
  })

  it('falls back to the raw id instead of crashing for a concept with no primary sense (regression)', () => {
    // Spec-legal: validateStructure only warns on "concept-without-sense",
    // never rejects it. A concept reachable as an associate can still lack a
    // primary sense — egoView must degrade, not throw, or one click white-screens the app.
    const g: PublishedGraph = {
      ...graph,
      concepts: { ...graph.concepts, c_0099: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' } },
    }
    let view: ReturnType<typeof egoView> | undefined
    expect(() => {
      view = egoView(g, 'c_0099')
    }).not.toThrow()
    expect(view!.nodes[0]).toMatchObject({ id: 'c_0099', label: 'c_0099', kind: 'center' })
  })
})
