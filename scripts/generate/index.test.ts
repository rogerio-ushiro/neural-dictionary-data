import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateStructure } from '../../src/model/v04/validate'
import type { PublishedGraph } from '../../src/model/v04/types'
import { runPipeline } from './index'
import type { AssociationSource, RawCandidate } from './contract'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndict-pipeline-'))
})
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

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

function writeSeed(): string {
  const p = path.join(tmpDir, 'graph.json')
  fs.writeFileSync(p, JSON.stringify(seed))
  return p
}

const fakeSource: AssociationSource = (task): RawCandidate[] => {
  if (task.concept_id !== 'c_0001') return []
  return [
    { lemma: 'acqua', relation_type: 'costituzione', association_strength: 0.9, confidence: 0.95 },
    { lemma: 'corallo', relation_type: 'contenuto', association_strength: 0.6, confidence: 0.85, pos: 'sostantivo', region: 'natura' },
    { lemma: 'vertigine', relation_type: 'evocativa', association_strength: 0.4, confidence: 0.2 }, // low-confidence, on a new lemma -> dropped
  ]
}

describe('runPipeline (T5.6)', () => {
  it('runs classify→dedup→relevance→coverage→publish end to end and writes a valid candidate/graph.json', async () => {
    const seedPath = writeSeed()
    const outDir = path.join(tmpDir, 'candidate')
    const result = await runPipeline(['c_0001'], { seedPath, outDir, associationSource: fakeSource })

    expect(result.candidateCount).toBe(2) // acqua (dup? no - not in seed yet) + corallo survive; vertigine dropped
    expect(result.droppedCount).toBe(1)

    const written = JSON.parse(fs.readFileSync(path.join(outDir, 'graph.json'), 'utf8')) as PublishedGraph
    expect(validateStructure(written).ok).toBe(true)
    expect(written.associations.some((a) => a.relation_type === 'costituzione')).toBe(true)
    expect(Object.values(written.words).some((w) => w.display_form === 'corallo')).toBe(true)
  })

  it('produces a coverage report per requested concept', async () => {
    const seedPath = writeSeed()
    const result = await runPipeline(['c_0001'], { seedPath, outDir: path.join(tmpDir, 'candidate'), associationSource: fakeSource })
    expect(result.coverageReport).toHaveLength(1)
    expect(result.coverageReport[0].concept_id).toBe('c_0001')
    expect(result.coverageReport[0].coveredAfter).toContain('costituzione')
  })

  it('produces a gap-loop entry per requested concept, without mutating status_fronteira', async () => {
    const seedPath = writeSeed()
    const outDir = path.join(tmpDir, 'candidate')
    const result = await runPipeline(['c_0001'], { seedPath, outDir, associationSource: fakeSource })
    expect(result.gapLoopReport).toHaveLength(1)
    const written = JSON.parse(fs.readFileSync(path.join(outDir, 'graph.json'), 'utf8')) as PublishedGraph
    expect(written.concepts.c_0001.status_fronteira).toBe('needs_expansion')
  })

  it('a concept with no candidates from the source is still reported (empty coverage delta)', async () => {
    const seedPath = writeSeed()
    const result = await runPipeline(['c_0002'], { seedPath, outDir: path.join(tmpDir, 'candidate'), associationSource: fakeSource })
    expect(result.candidateCount).toBe(0)
    expect(result.coverageReport[0].coveredAfter).toEqual(result.coverageReport[0].coveredBefore)
  })

  // Regressions for the two crash-the-whole-batch bugs the Story 5 review found.

  it('does not crash when a source re-proposes a pair already persisted as rejected in the seed', async () => {
    const seedWithRejected: PublishedGraph = {
      ...seed,
      associations: [{ concept_a: 'c_0001', concept_b: 'c_0002', relation_type: 'costituzione', association_strength: 0.9, confidence: 0.3, status: 'rejected', revision: 1 }],
    }
    const seedPath = path.join(tmpDir, 'seed-with-rejected.json')
    fs.writeFileSync(seedPath, JSON.stringify(seedWithRejected))

    const reproposing: AssociationSource = () => [{ lemma: 'acqua', relation_type: 'costituzione', association_strength: 0.4, confidence: 0.3 }]
    const outDir = path.join(tmpDir, 'candidate-rejected')
    const result = await runPipeline(['c_0001'], { seedPath, outDir, associationSource: reproposing })

    expect(result.candidateCount).toBe(0) // still low-confidence -> rejected again, but not a NEW row
    const written = JSON.parse(fs.readFileSync(path.join(outDir, 'graph.json'), 'utf8')) as PublishedGraph
    expect(validateStructure(written).ok).toBe(true)
    expect(written.associations).toHaveLength(1) // the original rejected row, not duplicated
  })

  it('does not crash when two different concepts in the same batch independently propose the same existing pair', async () => {
    // c_0001 ("mare") proposes acqua; c_0002 ("acqua") independently proposes mare —
    // both canonicalize to the same (c_0001, c_0002, relation_type) pair.
    const crossProposing: AssociationSource = (task) =>
      task.concept_id === 'c_0001'
        ? [{ lemma: 'acqua', relation_type: 'categoria', association_strength: 0.9, confidence: 0.95 }]
        : [{ lemma: 'mare', relation_type: 'categoria', association_strength: 0.9, confidence: 0.95 }]

    const seedPath = writeSeed()
    const outDir = path.join(tmpDir, 'candidate-cross')
    const result = await runPipeline(['c_0001', 'c_0002'], { seedPath, outDir, associationSource: crossProposing })

    expect(result.candidateCount).toBe(1) // only the first one survives; the second is a batch duplicate
    const written = JSON.parse(fs.readFileSync(path.join(outDir, 'graph.json'), 'utf8')) as PublishedGraph
    expect(validateStructure(written).ok).toBe(true)
    expect(written.associations.filter((a) => a.relation_type === 'categoria')).toHaveLength(1)
  })
})
