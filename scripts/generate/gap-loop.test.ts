import { describe, expect, it } from 'vitest'
import { evaluateGapLoop, MARGINAL_GAIN_MIN } from './gap-loop'
import type { PublishedGraph } from '../../src/model/v04/types'
import type { EvaluatedCandidate } from './stages/relevance'

function graphOf(): PublishedGraph {
  return {
    meta: { language: 'it' },
    words: { w_0001: { display_form: 'mare', normalized_form: 'mare', pos: null } },
    expressions: {},
    word_senses: { s_0001: { lexeme_id: 'w_0001', lexeme_kind: 'word', concept_id: 'c_0001', is_primary: true } },
    concepts: { c_0001: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' } },
    associations: [],
    lexical_index: [],
    semantic_regions: {},
    expansion_queue: [],
    sync_state: { manifest_version: null, ready: false },
  }
}

function evaluated(overrides: Partial<EvaluatedCandidate>): EvaluatedCandidate {
  return {
    lemma: 'x',
    relation_type: 'categoria',
    association_strength: 0.7,
    confidence: 0.9,
    knownRelationType: true,
    targetConceptId: null,
    isSelfLoop: false,
    isDuplicate: false,
    status: 'candidate',
    ...overrides,
  }
}

describe('evaluateGapLoop', () => {
  it('stops when useful count is below the marginal-gain minimum', () => {
    const result = evaluateGapLoop(graphOf(), 'c_0001', [evaluated({ status: 'rejected', rejectReason: 'low-confidence' })])
    expect(result.usefulCount).toBe(0)
    expect(result.stopped).toBe(MARGINAL_GAIN_MIN > 0)
  })

  it('does not stop once useful count reaches the minimum', () => {
    const result = evaluateGapLoop(graphOf(), 'c_0001', [evaluated({ status: 'candidate' })])
    expect(result.usefulCount).toBe(1)
    expect(result.stopped).toBe(false)
  })

  it('previews wouldSatisfyD9IfValidated without mutating the real graph', () => {
    const g = graphOf()
    const dims = ['categoria', 'costituzione', 'parti', 'contenuto', 'fenomeni', 'azioni', 'oggetti', 'luoghi']
    const survivors = dims.map((d, i) => evaluated({ relation_type: d, status: 'candidate', targetConceptId: `c_${String(i + 2).padStart(4, '0')}` }))
    const result = evaluateGapLoop(g, 'c_0001', survivors)
    expect(result.wouldSatisfyD9IfValidated).toBe(true)
    expect(g.associations).toHaveLength(0) // the real graph was never touched
  })

  it('reports false for wouldSatisfyD9IfValidated when candidates are too few/thin', () => {
    const result = evaluateGapLoop(graphOf(), 'c_0001', [evaluated({ status: 'candidate' })])
    expect(result.wouldSatisfyD9IfValidated).toBe(false)
  })
})
