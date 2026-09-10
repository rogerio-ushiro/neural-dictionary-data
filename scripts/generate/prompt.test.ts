import { describe, expect, it } from 'vitest'
import { SYSTEM } from './prompt'

describe('generation SYSTEM prompt', () => {
  it('offers the §7 dimensions + associata but never `sinonimo`', () => {
    expect(SYSTEM).toContain('categoria')
    expect(SYSTEM).toContain('associata')
    expect(SYSTEM).not.toContain('sinonimo')
  })
})
