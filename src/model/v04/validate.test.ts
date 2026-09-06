import { describe, expect, it } from 'vitest'
import type { PublishedGraph } from './types'
import { validatePublishedClosure, validateStructure } from './validate'

// A tiny well-formed graph: mare — acqua — onda, all validated, all still
// needs_expansion (so the closure invariant is vacuous).
const base: PublishedGraph = {
  meta: { language: 'it' },
  words: {
    w_0001: { display_form: 'mare', normalized_form: 'mare', pos: null },
    w_0002: { display_form: 'acqua', normalized_form: 'acqua', pos: null },
    w_0003: { display_form: 'onda', normalized_form: 'onda', pos: null },
  },
  expressions: {},
  word_senses: {
    s_0001: { lexeme_id: 'w_0001', lexeme_kind: 'word', concept_id: 'c_0001', is_primary: true },
    s_0002: { lexeme_id: 'w_0002', lexeme_kind: 'word', concept_id: 'c_0002', is_primary: true },
    s_0003: { lexeme_id: 'w_0003', lexeme_kind: 'word', concept_id: 'c_0003', is_primary: true },
  },
  concepts: {
    c_0001: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' },
    c_0002: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' },
    c_0003: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' },
  },
  associations: [
    { concept_a: 'c_0001', concept_b: 'c_0002', relation_type: 'associata', direction_hint: 'symmetric', association_strength: 0.9, confidence: 1, status: 'validated', revision: 1 },
    { concept_a: 'c_0001', concept_b: 'c_0003', relation_type: 'associata', direction_hint: 'symmetric', association_strength: 0.65, confidence: 1, status: 'validated', revision: 1 },
    { concept_a: 'c_0002', concept_b: 'c_0003', relation_type: 'associata', direction_hint: 'symmetric', association_strength: 0.4, confidence: 1, status: 'validated', revision: 1 },
  ],
  lexical_index: [
    { normalized_form: 'mare', lexeme_id: 'w_0001', lexeme_kind: 'word' },
    { normalized_form: 'acqua', lexeme_id: 'w_0002', lexeme_kind: 'word' },
    { normalized_form: 'onda', lexeme_id: 'w_0003', lexeme_kind: 'word' },
  ],
  semantic_regions: { r_natura: { label: 'natura' } },
  expansion_queue: [
    { concept_id: 'c_0001', expansion_priority: 0.5 },
    { concept_id: 'c_0002', expansion_priority: 0.4 },
    { concept_id: 'c_0003', expansion_priority: 0.3 },
  ],
  sync_state: { manifest_version: null, ready: false },
}

const clone = (g: PublishedGraph): PublishedGraph => JSON.parse(JSON.stringify(g))

describe('validateStructure', () => {
  it('accepts a well-formed graph', () => {
    const res = validateStructure(base)
    expect(res.ok).toBe(true)
    expect(res.issues).toEqual([])
  })

  it('rejects a bad shape (association_strength out of range)', () => {
    const bad = clone(base)
    bad.associations[0].association_strength = 1.5
    const res = validateStructure(bad)
    expect(res.ok).toBe(false)
    expect(res.issues.every((i) => i.kind === 'shape')).toBe(true)
  })

  it('flags an association endpoint missing from concepts', () => {
    const bad = clone(base)
    bad.associations.push({ concept_a: 'c_0003', concept_b: 'c_9999', relation_type: 'associata', association_strength: 0.5, confidence: 1, status: 'validated', revision: 1 })
    expect(validateStructure(bad).issues.map((i) => i.kind)).toContain('orphan-association-endpoint')
  })

  it('flags a non-canonical association (concept_a >= concept_b)', () => {
    const bad = clone(base)
    bad.associations[0] = { concept_a: 'c_0002', concept_b: 'c_0001', relation_type: 'associata', association_strength: 0.9, confidence: 1, status: 'validated', revision: 1 }
    expect(validateStructure(bad).issues.map((i) => i.kind)).toContain('association-not-canonical')
  })

  it('flags a duplicate (pair, relation_type)', () => {
    const bad = clone(base)
    bad.associations.push({ concept_a: 'c_0001', concept_b: 'c_0002', relation_type: 'associata', association_strength: 0.3, confidence: 1, status: 'validated', revision: 1 })
    expect(validateStructure(bad).issues.map((i) => i.kind)).toContain('duplicate-association')
  })

  it('allows the same pair with a different relation_type', () => {
    const ok = clone(base)
    ok.associations.push({ concept_a: 'c_0001', concept_b: 'c_0002', relation_type: 'costituzione', association_strength: 0.8, confidence: 1, status: 'validated', revision: 1 })
    expect(validateStructure(ok).ok).toBe(true)
  })

  it('flags a dangling sense → concept reference', () => {
    const bad = clone(base)
    bad.word_senses.s_0001.concept_id = 'c_9999'
    expect(validateStructure(bad).issues.map((i) => i.kind)).toContain('dangling-sense-concept')
  })

  it('flags a concept region that is not a known region', () => {
    const bad = clone(base)
    bad.concepts.c_0001.region_id = 'r_bogus'
    expect(validateStructure(bad).issues.map((i) => i.kind)).toContain('dangling-concept-region')
  })

  it('warns (not errors) on an unknown relation_type', () => {
    const g = clone(base)
    g.associations[0].relation_type = 'sfumatura_poetica'
    const res = validateStructure(g)
    expect(res.ok).toBe(true)
    expect(res.warnings.map((w) => w.kind)).toContain('unknown-relation-type')
  })

  it('warns on a concept no sense points at', () => {
    const g = clone(base)
    g.concepts.c_0004 = { revision: 1, region_id: null, status_fronteira: 'needs_expansion' }
    const res = validateStructure(g)
    expect(res.ok).toBe(true)
    expect(res.warnings.map((w) => w.kind)).toContain('concept-without-sense')
  })

  it('warns (not errors) on a concept with no definition yet', () => {
    const res = validateStructure(base)
    expect(res.ok).toBe(true)
    expect(res.warnings.filter((w) => w.kind === 'concept-without-definition').map((w) => w.detail)).toEqual([
      'c_0001',
      'c_0002',
      'c_0003',
    ])
  })

  it('does not warn when every concept has a complete definition', () => {
    const g = clone(base)
    for (const c of Object.values(g.concepts)) c.definition = { text: 'Def.', example: 'Esempio.' }
    const res = validateStructure(g)
    expect(res.ok).toBe(true)
    expect(res.warnings.map((w) => w.kind)).not.toContain('concept-without-definition')
  })

  it('rejects (hard) a definition present with an empty field', () => {
    const bad = clone(base)
    bad.concepts.c_0001.definition = { text: '', example: 'Esempio.' }
    const res = validateStructure(bad)
    expect(res.ok).toBe(false)
    expect(res.issues.every((i) => i.kind === 'shape')).toBe(true)
  })
})

describe('validatePublishedClosure', () => {
  it('passes when no concept is expanded', () => {
    expect(validatePublishedClosure(base).ok).toBe(true)
  })

  it('passes when an expanded concept has a validated associate', () => {
    const g = clone(base)
    g.concepts.c_0001.status_fronteira = 'expanded'
    expect(validatePublishedClosure(g).ok).toBe(true)
  })

  it('flags an expanded concept with no validated associate', () => {
    const g = clone(base)
    g.concepts.c_0004 = { revision: 1, region_id: null, status_fronteira: 'expanded' }
    g.word_senses.s_0004 = { lexeme_id: 'w_0004', lexeme_kind: 'word', concept_id: 'c_0004', is_primary: true }
    g.words.w_0004 = { display_form: 'schiuma', normalized_form: 'schiuma', pos: null }
    g.lexical_index.push({ normalized_form: 'schiuma', lexeme_id: 'w_0004', lexeme_kind: 'word' })
    const res = validatePublishedClosure(g)
    expect(res.ok).toBe(false)
    expect(res.issues.map((i) => i.kind)).toContain('expanded-concept-dead-end')
  })

  it('treats a candidate-only associate as not closing the concept', () => {
    const g = clone(base)
    g.concepts.c_0001.status_fronteira = 'expanded'
    for (const a of g.associations) a.status = 'candidate'
    expect(validatePublishedClosure(g).ok).toBe(false)
  })
})
