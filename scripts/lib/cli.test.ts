import { describe, expect, it } from 'vitest'
import { parseFlags } from './cli'

describe('parseFlags', () => {
  it('parses allowed flags into an object', () => {
    expect(parseFlags(['--in', 'a.json', '--out', 'b.json'], ['in', 'out'])).toEqual({ in: 'a.json', out: 'b.json' })
  })

  it('returns an empty object for empty argv', () => {
    expect(parseFlags([], ['in', 'out'])).toEqual({})
  })

  it('throws on an unrecognised flag', () => {
    expect(() => parseFlags(['--nope', 'x'], ['in'])).toThrow('unknown arg: --nope')
  })

  it('throws on a bare value with no leading flag', () => {
    expect(() => parseFlags(['x.json'], ['in'])).toThrow('unknown arg: x.json')
  })
})
