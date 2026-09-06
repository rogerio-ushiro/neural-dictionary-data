import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PublishedGraph } from '../../../src/model/v04/types'
import { applyDefinitions } from './apply'

let tmp: string
let seedPath: string
let dataDir: string
let backupDir: string

const baseGraph = (): PublishedGraph => ({
  meta: { language: 'it' },
  words: {
    w_0001: { display_form: 'mare', normalized_form: 'mare', pos: null },
    w_0002: { display_form: 'acqua', normalized_form: 'acqua', pos: null },
  },
  expressions: {},
  word_senses: {
    s_0001: { lexeme_id: 'w_0001', lexeme_kind: 'word', concept_id: 'c_0001', is_primary: true },
    s_0002: { lexeme_id: 'w_0002', lexeme_kind: 'word', concept_id: 'c_0002', is_primary: true },
  },
  concepts: {
    c_0001: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' },
    c_0002: { revision: 3, region_id: null, status_fronteira: 'needs_expansion' },
  },
  associations: [
    { concept_a: 'c_0001', concept_b: 'c_0002', relation_type: 'associata', association_strength: 0.9, confidence: 1, status: 'validated', revision: 1 },
  ],
  lexical_index: [
    { normalized_form: 'mare', lexeme_id: 'w_0001', lexeme_kind: 'word' },
    { normalized_form: 'acqua', lexeme_id: 'w_0002', lexeme_kind: 'word' },
  ],
  semantic_regions: {},
  expansion_queue: [],
  sync_state: { manifest_version: null, ready: false },
})

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ndict-apply-'))
  seedPath = path.join(tmp, 'graph.json')
  dataDir = path.join(tmp, 'data')
  backupDir = path.join(tmp, 'backups')
  fs.mkdirSync(dataDir)
  fs.writeFileSync(seedPath, `${JSON.stringify(baseGraph(), null, 2)}\n`)
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function input(cid: string, text: string, example: string): void {
  fs.writeFileSync(path.join(dataDir, `${cid}.json`), JSON.stringify({ concept_id: cid, text, example }))
}
function readSeed(): PublishedGraph {
  return JSON.parse(fs.readFileSync(seedPath, 'utf8'))
}

describe('applyDefinitions', () => {
  it('merges a definition, bumps only that concept’s revision, leaves associations untouched', () => {
    input('c_0001', 'Distesa di acqua salata.', 'Il mare era calmo.')
    const r = applyDefinitions({ seedPath, dataDir, backupDir })

    expect(r.changed).toEqual(['c_0001'])
    const g = readSeed()
    expect(g.concepts.c_0001).toEqual({
      revision: 2,
      region_id: null,
      status_fronteira: 'needs_expansion',
      definition: { text: 'Distesa di acqua salata.', example: 'Il mare era calmo.' },
    })
    expect(g.concepts.c_0002.revision).toBe(3) // untouched
    expect(g.associations).toEqual(baseGraph().associations)
  })

  it('is idempotent — a second run with the same input changes nothing', () => {
    input('c_0001', 'Def.', 'Esempio.')
    applyDefinitions({ seedPath, dataDir, backupDir })
    const afterFirst = readSeed()

    const r2 = applyDefinitions({ seedPath, dataDir, backupDir })
    expect(r2.changed).toEqual([])
    expect(r2.unchanged).toEqual(['c_0001'])
    expect(r2.wrote).toBe(false)
    expect(readSeed()).toEqual(afterFirst)
  })

  it('re-bumps revision when the text actually changes', () => {
    input('c_0001', 'Def. v1.', 'Esempio.')
    applyDefinitions({ seedPath, dataDir, backupDir })
    input('c_0001', 'Def. v2.', 'Esempio.')
    const r = applyDefinitions({ seedPath, dataDir, backupDir })
    expect(r.changed).toEqual(['c_0001'])
    expect(readSeed().concepts.c_0001.revision).toBe(3)
  })

  it('writes a backup before mutating the seed', () => {
    input('c_0001', 'Def.', 'Esempio.')
    const r = applyDefinitions({ seedPath, dataDir, backupDir })
    expect(r.backupPath).toBeTruthy()
    expect(JSON.parse(fs.readFileSync(r.backupPath as string, 'utf8')).concepts.c_0001.definition).toBeUndefined()
  })

  it('reports an input whose concept is absent from the seed and skips it', () => {
    input('c_0009', 'Def.', 'Esempio.')
    const r = applyDefinitions({ seedPath, dataDir, backupDir })
    expect(r.missingConcept).toEqual(['c_0009'])
    expect(r.changed).toEqual([])
    expect(r.wrote).toBe(false)
  })

  it('surfaces malformed inputs without aborting the valid ones', () => {
    input('c_0001', 'Buona.', 'Esempio.')
    fs.writeFileSync(path.join(dataDir, 'c_0002.json'), JSON.stringify({ concept_id: 'c_0002', text: '', example: 'x' }))
    const r = applyDefinitions({ seedPath, dataDir, backupDir })
    expect(r.changed).toEqual(['c_0001'])
    expect(r.invalidInputs.map((i) => i.file)).toEqual(['c_0002.json'])
  })

  it('does not write on --dry-run', () => {
    input('c_0001', 'Def.', 'Esempio.')
    const r = applyDefinitions({ seedPath, dataDir, backupDir, dryRun: true })
    expect(r.changed).toEqual(['c_0001'])
    expect(r.wrote).toBe(false)
    expect(readSeed().concepts.c_0001.definition).toBeUndefined()
  })
})
