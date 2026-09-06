import { describe, expect, it } from 'vitest'
import { evaluateRelevance } from './relevance'
import type { ResolvedCandidate } from './dedup'

function candidate(overrides: Partial<ResolvedCandidate>): ResolvedCandidate {
  return {
    lemma: 'x',
    relation_type: 'evocativa',
    association_strength: 0.6,
    confidence: 0.9,
    knownRelationType: true,
    targetConceptId: 'c_0002',
    isSelfLoop: false,
    isDuplicate: false,
    ...overrides,
  }
}

describe('evaluateRelevance', () => {
  it('rejects a self-loop regardless of confidence', () => {
    const [c] = evaluateRelevance([candidate({ isSelfLoop: true, confidence: 0.99 })])
    expect(c.status).toBe('rejected')
    expect(c.rejectReason).toBe('self-loop')
  })

  it('rejects a duplicate regardless of confidence', () => {
    const [c] = evaluateRelevance([candidate({ isDuplicate: true, confidence: 0.99 })])
    expect(c.status).toBe('rejected')
    expect(c.rejectReason).toBe('duplicate')
  })

  it('rejects a low-confidence candidate below the D11 threshold', () => {
    const [c] = evaluateRelevance([candidate({ confidence: 0.2 })])
    expect(c.status).toBe('rejected')
    expect(c.rejectReason).toBe('low-confidence')
  })

  it('a confidence exactly at the threshold survives (strict less-than)', () => {
    const [c] = evaluateRelevance([candidate({ confidence: 0.5 })])
    expect(c.status).toBe('candidate')
  })

  it('a confidence just below the threshold is rejected', () => {
    const [c] = evaluateRelevance([candidate({ confidence: 0.49 })])
    expect(c.status).toBe('rejected')
  })

  it('survives as candidate above the threshold with no mechanical flag', () => {
    const [c] = evaluateRelevance([candidate({ confidence: 0.8 })])
    expect(c.status).toBe('candidate')
    expect(c.rejectReason).toBeUndefined()
  })

  it('self-loop check takes priority over duplicate', () => {
    const [c] = evaluateRelevance([candidate({ isSelfLoop: true, isDuplicate: true })])
    expect(c.rejectReason).toBe('self-loop')
  })
})
