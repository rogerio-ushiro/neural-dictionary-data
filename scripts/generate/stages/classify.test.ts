import { describe, expect, it } from 'vitest'
import { classify } from './classify'
import type { RawCandidate } from '../contract'

describe('classify', () => {
  it('trims relation_type and flags it as known', () => {
    const [c] = classify([{ lemma: 'acqua', relation_type: ' costituzione ', association_strength: 0.9 }])
    expect(c.relation_type).toBe('costituzione')
    expect(c.knownRelationType).toBe(true)
  })

  it('flags an unrecognised relation_type without dropping it', () => {
    const raw: RawCandidate[] = [{ lemma: 'x', relation_type: 'sfumatura_poetica', association_strength: 0.5 }]
    const [c] = classify(raw)
    expect(c.knownRelationType).toBe(false)
    expect(c.lemma).toBe('x')
  })
})
