import { describe, expect, it } from 'vitest'
import { validateStructure } from '../../src/model/v04/validate'
import type { PublishedGraph } from '../../src/model/v04/types'
import { publish } from './publish'
import type { EvaluatedCandidate } from './stages/relevance'

function seed(): PublishedGraph {
  return {
    meta: { language: 'it' },
    words: { w_0001: { display_form: 'mare', normalized_form: 'mare', pos: null }, w_0002: { display_form: 'acqua', normalized_form: 'acqua', pos: null } },
    expressions: {},
    word_senses: {
      s_0001: { lexeme_id: 'w_0001', lexeme_kind: 'word', concept_id: 'c_0001', is_primary: true },
      s_0002: { lexeme_id: 'w_0002', lexeme_kind: 'word', concept_id: 'c_0002', is_primary: true },
    },
    concepts: { c_0001: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' }, c_0002: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' } },
    associations: [],
    lexical_index: [
      { normalized_form: 'mare', lexeme_id: 'w_0001', lexeme_kind: 'word' },
      { normalized_form: 'acqua', lexeme_id: 'w_0002', lexeme_kind: 'word' },
    ],
    semantic_regions: { r_natura: { label: 'natura' } },
    expansion_queue: [],
    sync_state: { manifest_version: null, ready: false },
  }
}

function candidate(overrides: Partial<EvaluatedCandidate>): EvaluatedCandidate {
  return {
    lemma: 'x',
    relation_type: 'evocativa',
    association_strength: 0.6,
    confidence: 0.9,
    knownRelationType: true,
    targetConceptId: null,
    isSelfLoop: false,
    isDuplicate: false,
    status: 'candidate',
    ...overrides,
  }
}

describe('publish', () => {
  it('persists a surviving candidate against an existing target', () => {
    const outcome = publish(seed(), new Map([['c_0001', [candidate({ lemma: 'acqua', targetConceptId: 'c_0002', relation_type: 'costituzione' })]]]))
    expect(outcome.graph.associations).toHaveLength(1)
    expect(outcome.graph.associations[0]).toMatchObject({ concept_a: 'c_0001', concept_b: 'c_0002', relation_type: 'costituzione', status: 'candidate' })
  })

  it('mints a new word/concept/sense/lexical_index entry for a brand-new target', () => {
    const outcome = publish(seed(), new Map([['c_0001', [candidate({ lemma: 'conchiglia', pos: 'sostantivo', region: 'natura' })]]]))
    const newWordId = Object.keys(outcome.graph.words).find((id) => !['w_0001', 'w_0002'].includes(id))!
    expect(outcome.graph.words[newWordId]).toMatchObject({ display_form: 'conchiglia', pos: 'sostantivo' })
    const sense = Object.values(outcome.graph.word_senses).find((s) => s.lexeme_id === newWordId)!
    expect(outcome.graph.concepts[sense.concept_id].region_id).toBe('r_natura')
    expect(outcome.graph.lexical_index.some((e) => e.normalized_form === 'conchiglia')).toBe(true)
  })

  it('mints a locution as an Expression when the lemma has a space', () => {
    const outcome = publish(seed(), new Map([['c_0001', [candidate({ lemma: 'al largo' })]]]))
    expect(Object.keys(outcome.graph.expressions)).toHaveLength(1)
    const expr = Object.values(outcome.graph.expressions)[0]
    expect(expr.display_form).toBe('al largo')
  })

  it('reuses the same minted concept when two candidates propose the same new lemma', () => {
    const outcome = publish(
      seed(),
      new Map([
        ['c_0001', [candidate({ lemma: 'conchiglia', relation_type: 'contenuto' })]],
        ['c_0002', [candidate({ lemma: 'conchiglia', relation_type: 'similarità' })]],
      ]),
    )
    expect(Object.keys(outcome.graph.words).length).toBe(3) // mare, acqua, + 1 new (not 2)
  })

  it('drops a self-loop reject without persisting it', () => {
    const outcome = publish(seed(), new Map([['c_0001', [candidate({ status: 'rejected', rejectReason: 'self-loop', targetConceptId: 'c_0001' })]]]))
    expect(outcome.graph.associations).toHaveLength(0)
    expect(outcome.dropped).toHaveLength(1)
    expect(outcome.dropped[0].reason).toBe('self-loop')
  })

  it('drops a duplicate reject without persisting it', () => {
    const outcome = publish(seed(), new Map([['c_0001', [candidate({ status: 'rejected', rejectReason: 'duplicate', targetConceptId: 'c_0002' })]]]))
    expect(outcome.graph.associations).toHaveLength(0)
  })

  it('persists a low-confidence reject against an EXISTING target (audit trail)', () => {
    const outcome = publish(seed(), new Map([['c_0001', [candidate({ status: 'rejected', rejectReason: 'low-confidence', targetConceptId: 'c_0002', relation_type: 'evocativa' })]]]))
    expect(outcome.graph.associations).toHaveLength(1)
    expect(outcome.graph.associations[0].status).toBe('rejected')
  })

  it('drops (does not mint) a low-confidence reject targeting a brand-new lemma', () => {
    const outcome = publish(seed(), new Map([['c_0001', [candidate({ status: 'rejected', rejectReason: 'low-confidence', targetConceptId: null })]]]))
    expect(Object.keys(outcome.graph.words)).toHaveLength(2) // no new word minted
    expect(outcome.graph.associations).toHaveLength(0)
  })

  it('always produces a graph that passes validateStructure', () => {
    const outcome = publish(
      seed(),
      new Map([
        ['c_0001', [
          candidate({ lemma: 'acqua', targetConceptId: 'c_0002', relation_type: 'costituzione' }),
          candidate({ lemma: 'corallo', relation_type: 'contenuto' }),
          candidate({ status: 'rejected', rejectReason: 'self-loop', targetConceptId: 'c_0001' }),
        ]],
      ]),
    )
    const res = validateStructure(outcome.graph)
    expect(res.ok).toBe(true)
    expect(res.issues).toEqual([])
  })

  it('never touches status_fronteira — that is Story 7 merge-time only', () => {
    const outcome = publish(seed(), new Map([['c_0001', [candidate({ lemma: 'acqua', targetConceptId: 'c_0002' })]]]))
    expect(outcome.graph.concepts.c_0001.status_fronteira).toBe('needs_expansion')
    expect(outcome.graph.concepts.c_0002.status_fronteira).toBe('needs_expansion')
  })
})
