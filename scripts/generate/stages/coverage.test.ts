import { describe, expect, it } from 'vitest'
import { computeCoverage } from './coverage'
import type { GenerationTask } from '../contract'
import type { EvaluatedCandidate } from './relevance'

const task: GenerationTask = {
  concept_id: 'c_0001',
  word: 'mare',
  existing_relations: [],
  covered_relation_types: ['costituzione'],
  missing_relation_types: ['categoria', 'parti', 'contenuto'],
  region: null,
}

function evaluated(overrides: Partial<EvaluatedCandidate>): EvaluatedCandidate {
  return {
    lemma: 'x',
    relation_type: 'categoria',
    association_strength: 0.7,
    confidence: 0.9,
    knownRelationType: true,
    targetConceptId: 'c_0002',
    isSelfLoop: false,
    isDuplicate: false,
    status: 'candidate',
    ...overrides,
  }
}

describe('computeCoverage', () => {
  it('adds surviving candidates’ relation_types to covered, keeps rejected ones out', () => {
    const report = computeCoverage(task, [
      evaluated({ relation_type: 'categoria', status: 'candidate' }),
      evaluated({ relation_type: 'parti', status: 'rejected', rejectReason: 'low-confidence' }),
    ])
    expect(report.coveredAfter).toContain('categoria')
    expect(report.coveredAfter).not.toContain('parti')
    expect(report.missingAfter).toContain('parti')
    expect(report.missingAfter).not.toContain('categoria')
  })

  it('collects the pos of every brand-new lexeme proposed', () => {
    const report = computeCoverage(task, [
      evaluated({ targetConceptId: null, pos: 'sostantivo', status: 'candidate' }),
      evaluated({ targetConceptId: 'c_0002', pos: 'verbo', status: 'candidate' }), // existing target, not counted
    ])
    expect(report.newLexicalClasses).toEqual(['sostantivo'])
  })

  it('leaves coveredBefore untouched from the task', () => {
    const report = computeCoverage(task, [])
    expect(report.coveredBefore).toEqual(['costituzione'])
  })
})
