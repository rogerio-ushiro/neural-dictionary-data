import { describe, expect, it } from 'vitest'
import { computeGraphHealth, formatReport } from './graph-health'
import type { Association, Concept, PublishedGraph } from '../../src/model/v04/types'

function assoc(
  a: string,
  b: string,
  relationType: string,
  status: Association['status'] = 'validated',
): Association {
  const [x, y] = a < b ? [a, b] : [b, a]
  return {
    concept_a: x,
    concept_b: y,
    relation_type: relationType,
    association_strength: 0.7,
    confidence: 1,
    status,
    revision: 1,
  }
}

function graph(overrides: Partial<PublishedGraph> = {}): PublishedGraph {
  const concepts: Record<string, Concept> = {
    c_0001: { revision: 1, region_id: 'r_natura', status_fronteira: 'expanded' },
    c_0002: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' },
    c_0003: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' },
  }
  return {
    meta: { language: 'it' },
    words: {
      w_0001: { display_form: 'mare', normalized_form: 'mare', pos: 'sostantivo' },
      w_0002: { display_form: 'acqua', normalized_form: 'acqua', pos: null },
      w_0003: { display_form: 'nuotare', normalized_form: 'nuotare', pos: 'verbo' },
    },
    expressions: {},
    word_senses: {},
    concepts,
    associations: [
      assoc('c_0001', 'c_0002', 'costituzione'),
      assoc('c_0001', 'c_0002', 'similarità'), // second, different type — not a duplicate
      assoc('c_0001', 'c_0003', 'associata', 'candidate'),
    ],
    lexical_index: [],
    semantic_regions: { r_natura: { label: 'natura' } },
    expansion_queue: [],
    sync_state: { manifest_version: null, ready: false },
    ...overrides,
  }
}

describe('computeGraphHealth', () => {
  it('counts concepts and associations', () => {
    const r = computeGraphHealth(graph())
    expect(r.conceptCount).toBe(3)
    expect(r.associationCount).toBe(3)
  })

  it('computes validated degree (excludes candidate)', () => {
    const r = computeGraphHealth(graph())
    // degrees: c_0001=2, c_0002=2, c_0003=0 (its only edge is candidate) → sorted [0,2,2]
    expect(r.medianValidatedDegree).toBe(2)
    expect(r.meanValidatedDegree).toBeCloseTo(1.33, 2)
  })

  it('reports frontier_debt as the count of needs_expansion concepts', () => {
    const r = computeGraphHealth(graph())
    expect(r.frontierDebt).toBe(2) // c_0002, c_0003
  })

  it('reports % adequate coverage from status_fronteira: expanded', () => {
    const r = computeGraphHealth(graph())
    expect(r.pctAdequateCoverage).toBeCloseTo(33.3, 1) // 1 of 3
  })

  it('reports % region assigned', () => {
    const r = computeGraphHealth(graph())
    expect(r.pctRegionAssigned).toBeCloseTo(33.3, 1) // c_0001 only
  })

  it('builds relation_type distribution from validated associations only', () => {
    const r = computeGraphHealth(graph())
    expect(r.relationTypeDistribution).toEqual({ costituzione: 1, similarità: 1 })
  })

  it('builds lexical class distribution over words + expressions, unknown for null pos', () => {
    const r = computeGraphHealth(graph())
    expect(r.lexicalClassDistribution.sostantivo).toBe(1)
    expect(r.lexicalClassDistribution.verbo).toBe(1)
    expect(r.lexicalClassDistribution.unknown).toBe(1)
  })

  it('flags duplicate associations', () => {
    const dup = graph()
    dup.associations.push(assoc('c_0001', 'c_0002', 'costituzione'))
    const r = computeGraphHealth(dup)
    expect(r.duplicateAssociations).toBe(1)
  })

  it('associationStatusDistribution counts every status', () => {
    const r = computeGraphHealth(graph())
    expect(r.associationStatusDistribution).toEqual({ candidate: 1, validated: 2, rejected: 0, deprecated: 0 })
  })
})

describe('formatReport', () => {
  it('renders every section as markdown, with blank lines preserved between them', () => {
    const md = formatReport(computeGraphHealth(graph()))
    expect(md).toContain('## Counts')
    expect(md).toContain('## relation_type distribution')
    expect(md).toContain('## Lexical class distribution')
    expect(md).toContain('## Region distribution')
    expect(md).toContain('## Association status distribution')
    expect(md).toContain('\n\n')
  })

  it('flags a relation_type outside the working set', () => {
    const g = graph()
    g.associations.push(assoc('c_0002', 'c_0003', 'sfumatura_poetica'))
    const md = formatReport(computeGraphHealth(g))
    expect(md).toContain('outside the working set: sfumatura_poetica')
  })
})
