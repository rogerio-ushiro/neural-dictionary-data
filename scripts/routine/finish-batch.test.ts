import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateStructure } from '../../src/model/v04/validate'
import type { PublishedGraph } from '../../src/model/v04/types'
import { finishBatch, perConceptReport } from './finish-batch'
import { buildPacks } from '../pack/build-packs'
import { writeManifest } from '../pack/manifest'
import { DATA_DIR, fileKey } from '../generate/file-source'
import type { AssociationSource } from '../generate/contract'

let tmpDir: string
let seedPath: string
let candidateDir: string
let packsDir: string

const seed: PublishedGraph = {
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

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndict-finish-batch-'))
  seedPath = path.join(tmpDir, 'seed', 'graph.json')
  candidateDir = path.join(tmpDir, 'candidate')
  packsDir = path.join(tmpDir, 'packs')
  fs.mkdirSync(path.dirname(seedPath), { recursive: true })
  fs.writeFileSync(seedPath, JSON.stringify(seed))
  buildPacks(seedPath, packsDir)
  writeManifest(packsDir)
})
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

const emptySource: AssociationSource = () => []

describe('finishBatch (routine)', () => {
  it('promotes the candidate graph to seed, even with zero new candidates', async () => {
    const result = await finishBatch(['c_0001'], { seedPath, candidateDir, packsDir, associationSource: emptySource })
    expect(result.pipeline.candidateCount).toBe(0)
    const promoted = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as PublishedGraph
    expect(promoted.concepts.c_0001).toBeDefined()
  })

  it('rebuilds packs from the promoted seed and produces a valid reconstructed graph', async () => {
    const source: AssociationSource = (task) =>
      task.concept_id === 'c_0001' ? [{ lemma: 'corallo', relation_type: 'contenuto', association_strength: 0.6, confidence: 0.9, pos: 'sostantivo' }] : []
    await finishBatch(['c_0001'], { seedPath, candidateDir, packsDir, associationSource: source })

    const manifest = JSON.parse(fs.readFileSync(path.join(packsDir, 'manifest.json'), 'utf8'))
    expect(manifest.packs.length).toBeGreaterThan(0)
    const promoted = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as PublishedGraph
    expect(Object.values(promoted.words).some((w) => w.display_form === 'corallo')).toBe(true)
    expect(validateStructure(promoted).ok).toBe(true)
  })

  it('produces patches against the pre-existing packs (not a from-scratch manifest)', async () => {
    const source: AssociationSource = (task) =>
      task.concept_id === 'c_0001' ? [{ lemma: 'acqua', relation_type: 'costituzione', association_strength: 0.9, confidence: 0.95 }] : []
    const result = await finishBatch(['c_0001'], { seedPath, candidateDir, packsDir, associationSource: source })
    expect(result.patchedPacks).toBeGreaterThan(0)
  })

  it('reports the paths the caller should git add', async () => {
    const result = await finishBatch(['c_0001'], { seedPath, candidateDir, packsDir, associationSource: emptySource })
    expect(result.changedPaths).toContain(seedPath)
    expect(result.changedPaths).toContain(packsDir)
  })

  it('includes the source data/<lemma>.json file the agent wrote, when using the default fileSource', async () => {
    // mare.json is c_0001's word in this test seed. finishBatch's default
    // associationSource (fileSource) reads scripts/generate/data/mare.json —
    // an existing real file, unaffected by this run since we don't override it.
    const dataFile = path.join(DATA_DIR, `${fileKey('mare')}.json`)
    expect(fs.existsSync(dataFile)).toBe(true)

    const result = await finishBatch(['c_0001'], { seedPath, candidateDir, packsDir })
    expect(result.changedPaths).toContain(dataFile)
  })
})

describe('perConceptReport', () => {
  it('flags a concept that produced nothing (useful=0) and one that would not reach D9', () => {
    const report = perConceptReport({
      coverageReport: [
        { concept_id: 'c_0001', word: 'mare', coveredBefore: [], coveredAfter: ['categoria'], missingAfter: ['parti'], newLexicalClasses: [] },
        { concept_id: 'c_0002', word: 'acqua', coveredBefore: ['categoria'], coveredAfter: ['categoria', 'parti', 'contenuto', 'proprietà', 'azioni'], missingAfter: [], newLexicalClasses: [] },
      ],
      gapLoopReport: [
        { concept_id: 'c_0001', usefulCount: 0, rejectedCount: 0, stopped: true, wouldSatisfyD9IfValidated: false },
        { concept_id: 'c_0002', usefulCount: 9, rejectedCount: 1, stopped: false, wouldSatisfyD9IfValidated: true },
      ],
    })
    expect(report).toContain('c_0001')
    expect(report).toMatch(/c_0001.*useful= 0.*D9=NO/)
    expect(report).toMatch(/c_0002.*useful= 9.*D9=yes/)
  })
})
