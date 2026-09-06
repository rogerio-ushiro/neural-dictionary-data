import { describe, expect, it } from 'vitest'
import { classify } from './classify'
import { buildDedupContext, resolveDedup } from './dedup'
import type { PublishedGraph } from '../../../src/model/v04/types'

const graph: PublishedGraph = {
  meta: { language: 'it' },
  words: { w_0001: { display_form: 'mare', normalized_form: 'mare', pos: null }, w_0002: { display_form: 'acqua', normalized_form: 'acqua', pos: null } },
  expressions: {},
  word_senses: {
    s_0001: { lexeme_id: 'w_0001', lexeme_kind: 'word', concept_id: 'c_0001', is_primary: true },
    s_0002: { lexeme_id: 'w_0002', lexeme_kind: 'word', concept_id: 'c_0002', is_primary: true },
  },
  concepts: { c_0001: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' }, c_0002: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' } },
  associations: [{ concept_a: 'c_0001', concept_b: 'c_0002', relation_type: 'costituzione', association_strength: 0.9, confidence: 1, status: 'validated', revision: 1 }],
  lexical_index: [
    { normalized_form: 'mare', lexeme_id: 'w_0001', lexeme_kind: 'word' },
    { normalized_form: 'acqua', lexeme_id: 'w_0002', lexeme_kind: 'word' },
  ],
  semantic_regions: {},
  expansion_queue: [],
  sync_state: { manifest_version: null, ready: false },
}

function resolve(sourceConceptId: string, candidates: Parameters<typeof classify>[0], seenInBatch = new Set<string>()) {
  return resolveDedup(buildDedupContext(graph), sourceConceptId, classify(candidates), seenInBatch)
}

describe('resolveDedup', () => {
  it('resolves a lemma matching an existing word to its concept id', () => {
    const [c] = resolve('c_0001', [{ lemma: 'acqua', relation_type: 'evocativa', association_strength: 0.5 }])
    expect(c.targetConceptId).toBe('c_0002')
  })

  it('resolves an unrecognised lemma as brand-new (null target)', () => {
    const [c] = resolve('c_0001', [{ lemma: 'conchiglia', relation_type: 'contenuto', association_strength: 0.5 }])
    expect(c.targetConceptId).toBeNull()
  })

  it('resolves accent-insensitively', () => {
    const [c] = resolve('c_0001', [{ lemma: 'Àcqua', relation_type: 'evocativa', association_strength: 0.5 }])
    expect(c.targetConceptId).toBe('c_0002')
  })

  it('flags a self-loop (candidate resolves to the source concept itself)', () => {
    const [c] = resolve('c_0001', [{ lemma: 'Mare', relation_type: 'similarità', association_strength: 0.5 }])
    expect(c.isSelfLoop).toBe(true)
  })

  it('flags a duplicate already present in the graph, validated', () => {
    const [c] = resolve('c_0001', [{ lemma: 'acqua', relation_type: 'costituzione', association_strength: 0.5 }])
    expect(c.isDuplicate).toBe(true)
  })

  it('flags a duplicate already present in the graph as `rejected` — not just validated/candidate', () => {
    const g: PublishedGraph = { ...graph, associations: [{ ...graph.associations[0], status: 'rejected' }] }
    const [c] = resolveDedup(
      buildDedupContext(g),
      'c_0001',
      classify([{ lemma: 'acqua', relation_type: 'costituzione', association_strength: 0.5 }]),
      new Set(),
    )
    expect(c.isDuplicate).toBe(true)
  })

  it('does not flag the same pair with a different relation_type as duplicate', () => {
    const [c] = resolve('c_0001', [{ lemma: 'acqua', relation_type: 'similarità', association_strength: 0.5 }])
    expect(c.isDuplicate).toBe(false)
  })

  it('flags an intra-batch duplicate (two candidates, same new lemma + type)', () => {
    const [first, second] = resolve('c_0001', [
      { lemma: 'conchiglia', relation_type: 'contenuto', association_strength: 0.5 },
      { lemma: 'conchiglia', relation_type: 'contenuto', association_strength: 0.6 },
    ])
    expect(first.isDuplicate).toBe(false)
    expect(second.isDuplicate).toBe(true)
  })

  it('does NOT flag two different source concepts independently proposing the same new lemma+type', () => {
    // "mare" and "acqua" can both validly contenuto→"conchiglia" — this must
    // not collide just because both targets are the same not-yet-minted lemma.
    const seenInBatch = new Set<string>()
    const [fromMare] = resolveDedup(buildDedupContext(graph), 'c_0001', classify([{ lemma: 'conchiglia', relation_type: 'contenuto', association_strength: 0.5 }]), seenInBatch)
    const [fromAcqua] = resolveDedup(buildDedupContext(graph), 'c_0002', classify([{ lemma: 'conchiglia', relation_type: 'contenuto', association_strength: 0.6 }]), seenInBatch)
    expect(fromMare.isDuplicate).toBe(false)
    expect(fromAcqua.isDuplicate).toBe(false)
  })

  it('flags a repeat of the SAME source+new-lemma+type across two resolveDedup calls sharing seenInBatch', () => {
    // Simulates runPipeline calling resolveDedup once per concept with one
    // shared Set — a genuine repeat for the same source must still be caught.
    const seenInBatch = new Set<string>()
    const [first] = resolveDedup(buildDedupContext(graph), 'c_0001', classify([{ lemma: 'conchiglia', relation_type: 'contenuto', association_strength: 0.5 }]), seenInBatch)
    const [second] = resolveDedup(buildDedupContext(graph), 'c_0001', classify([{ lemma: 'conchiglia', relation_type: 'contenuto', association_strength: 0.6 }]), seenInBatch)
    expect(first.isDuplicate).toBe(false)
    expect(second.isDuplicate).toBe(true)
  })
})
