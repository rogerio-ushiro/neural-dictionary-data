import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readDefinitionInputs } from './file-source'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndict-defs-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

function write(name: string, content: unknown): void {
  fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content))
}

describe('readDefinitionInputs', () => {
  it('accepts a well-formed file keyed by concept_id', () => {
    write('c_0001.json', { concept_id: 'c_0001', text: 'Def.', example: 'Esempio.' })
    const { valid, invalid } = readDefinitionInputs(dir)
    expect(invalid).toEqual([])
    expect(valid).toEqual([{ concept_id: 'c_0001', text: 'Def.', example: 'Esempio.' }])
  })

  it('trims text and example', () => {
    write('c_0002.json', { concept_id: 'c_0002', text: '  Def.  ', example: '\tEsempio.\n' })
    expect(readDefinitionInputs(dir).valid[0]).toEqual({ concept_id: 'c_0002', text: 'Def.', example: 'Esempio.' })
  })

  it('rejects a file whose concept_id disagrees with its name', () => {
    write('c_0001.json', { concept_id: 'c_0002', text: 'Def.', example: 'Esempio.' })
    const { valid, invalid } = readDefinitionInputs(dir)
    expect(valid).toEqual([])
    expect(invalid[0].reason).toMatch(/does not match file name/)
  })

  it('rejects empty or missing fields', () => {
    write('c_0003.json', { concept_id: 'c_0003', text: '', example: 'Esempio.' })
    write('c_0004.json', { concept_id: 'c_0004', example: 'Esempio.' })
    const reasons = readDefinitionInputs(dir).invalid.map((i) => i.reason)
    expect(reasons).toEqual(['missing/empty "text"', 'missing/empty "text"'])
  })

  it('rejects invalid JSON without throwing', () => {
    write('c_0005.json', '{ not json')
    const { valid, invalid } = readDefinitionInputs(dir)
    expect(valid).toEqual([])
    expect(invalid[0].reason).toMatch(/invalid JSON/)
  })

  it('ignores non-json files and returns empty for a missing dir', () => {
    write('notes.txt', 'ignored')
    expect(readDefinitionInputs(dir).valid).toEqual([])
    expect(readDefinitionInputs(path.join(dir, 'nope'))).toEqual({ valid: [], invalid: [] })
  })
})
