import { describe, expect, it } from 'vitest'
import {
  GENERATED_RELATION_TYPES,
  RELATION_INVESTIGATION_ORDER,
  RELATION_TYPE_WORKING_SET,
  SYMMETRIC_RELATION_TYPES,
  isKnownRelationType,
} from './config'

describe('`sinonimo` relation_type (Story F2a)', () => {
  it('is a known type', () => {
    expect(RELATION_TYPE_WORKING_SET as readonly string[]).toContain('sinonimo')
    expect(isKnownRelationType('sinonimo')).toBe(true)
  })

  it('is symmetric', () => {
    expect(SYMMETRIC_RELATION_TYPES.has('sinonimo')).toBe(true)
  })

  it('is not a §7 investigation dimension — does not count toward D9', () => {
    expect(RELATION_INVESTIGATION_ORDER).not.toContain('sinonimo')
    expect(RELATION_INVESTIGATION_ORDER).toHaveLength(15)
  })

  it('is not something the generator may propose', () => {
    expect(GENERATED_RELATION_TYPES).not.toContain('sinonimo')
    // the pipeline still authors everything else, including `associata`
    expect(GENERATED_RELATION_TYPES).toContain('associata')
    expect(GENERATED_RELATION_TYPES).toContain('categoria')
    expect(GENERATED_RELATION_TYPES).toHaveLength(RELATION_TYPE_WORKING_SET.length - 1)
  })
})
