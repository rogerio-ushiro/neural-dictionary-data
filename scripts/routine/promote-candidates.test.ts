import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dryRunReport, promoteCandidates, runPromotion } from './promote-candidates'
import type { Association, PublishedGraph } from '../../src/model/v04/types'

function assoc(a: string, b: string, relationType: string, status: Association['status'] = 'candidate'): Association {
  const [x, y] = a < b ? [a, b] : [b, a]
  return { concept_a: x, concept_b: y, relation_type: relationType, association_strength: 0.7, confidence: 0.9, status, revision: 1 }
}

function graphWithEightCoveredDims(): PublishedGraph {
  const dims = ['categoria', 'costituzione', 'parti', 'contenuto', 'fenomeni', 'azioni', 'oggetti', 'luoghi']
  const associations = dims.map((d, i) => assoc('c_0001', `c_${String(i + 2).padStart(4, '0')}`, d))
  const concepts: PublishedGraph['concepts'] = { c_0001: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' } }
  for (let i = 2; i <= 9; i += 1) concepts[`c_${String(i).padStart(4, '0')}`] = { revision: 1, region_id: null, status_fronteira: 'needs_expansion' }
  return {
    meta: { language: 'it' },
    words: {},
    expressions: {},
    word_senses: {},
    concepts,
    associations,
    lexical_index: [],
    semantic_regions: {},
    expansion_queue: [],
    sync_state: { manifest_version: null, ready: false },
  }
}

describe('promoteCandidates', () => {
  it('promotes every candidate association to validated, bumping revision', () => {
    const graph = graphWithEightCoveredDims()
    const { graph: promoted, promotedAssociations } = promoteCandidates(graph)
    expect(promotedAssociations).toBe(8)
    expect(promoted.associations.every((a) => a.status === 'validated' && a.revision === 2)).toBe(true)
  })

  it('does not mutate the input graph', () => {
    const graph = graphWithEightCoveredDims()
    promoteCandidates(graph)
    expect(graph.associations[0].status).toBe('candidate')
  })

  it('flips a concept to expanded once D9 is satisfied by the newly-validated data', () => {
    const graph = graphWithEightCoveredDims()
    const { graph: promoted, expandedConcepts } = promoteCandidates(graph)
    expect(expandedConcepts).toBe(1)
    expect(promoted.concepts.c_0001.status_fronteira).toBe('expanded')
    expect(promoted.concepts.c_0001.revision).toBe(2)
  })

  it('leaves a concept needs_expansion when D9 is not yet satisfied', () => {
    const graph = graphWithEightCoveredDims()
    graph.associations = graph.associations.slice(0, 2) // only 2 of 8 dims
    const { graph: promoted, expandedConcepts } = promoteCandidates(graph)
    expect(expandedConcepts).toBe(0)
    expect(promoted.concepts.c_0001.status_fronteira).toBe('needs_expansion')
  })

  it('never demotes an already-expanded concept', () => {
    const graph = graphWithEightCoveredDims()
    graph.concepts.c_0001.status_fronteira = 'expanded'
    graph.associations = [] // no validated data at all now
    const { graph: promoted, expandedConcepts } = promoteCandidates(graph)
    expect(expandedConcepts).toBe(0)
    expect(promoted.concepts.c_0001.status_fronteira).toBe('expanded')
  })

  it('leaves already-validated associations alone (no double revision bump)', () => {
    const graph = graphWithEightCoveredDims()
    graph.associations[0].status = 'validated'
    const { graph: promoted, promotedAssociations } = promoteCandidates(graph)
    expect(promotedAssociations).toBe(7)
    expect(promoted.associations[0].revision).toBe(1)
  })
})

describe('runPromotion', () => {
  let tmpDir: string
  let seedPath: string
  let packsDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndict-promote-'))
    seedPath = path.join(tmpDir, 'graph.json')
    packsDir = path.join(tmpDir, 'packs')
  })
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

  it('writes the promoted graph back and rebuilds packs, end to end', async () => {
    fs.writeFileSync(seedPath, JSON.stringify(graphWithEightCoveredDims()))
    const result = await runPromotion(seedPath, packsDir)
    expect(result.expandedConcepts).toBe(1)

    const written = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as PublishedGraph
    expect(written.concepts.c_0001.status_fronteira).toBe('expanded')
    expect(fs.existsSync(path.join(packsDir, 'manifest.json'))).toBe(true)
  })

  it('produces patches against the pre-promotion packs, not just a from-scratch manifest', async () => {
    const graph = graphWithEightCoveredDims()
    fs.writeFileSync(seedPath, JSON.stringify(graph))
    // Build the packs as they'd already be published (pre-merge state) before
    // promoting, so there's a real "old" version for diffManifest to compare.
    const { buildPacks } = await import('../pack/build-packs')
    const { writeManifest } = await import('../pack/manifest')
    buildPacks(seedPath, packsDir)
    writeManifest(packsDir)

    const result = await runPromotion(seedPath, packsDir)
    expect(result.patchedPacks).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(packsDir, 'patches'))).toBe(true)
  })

  it('throws and leaves the seed untouched when the promoted graph fails validatePublishedClosure', async () => {
    // A concept marked `expanded` by hand, but with zero associations at all —
    // promotion can't fix this (it only ever adds expanded, never removes it),
    // so closure must fail and the write must not happen.
    const graph = graphWithEightCoveredDims()
    graph.associations = []
    graph.concepts.c_0001.status_fronteira = 'expanded'
    fs.writeFileSync(seedPath, JSON.stringify(graph))
    const before = fs.readFileSync(seedPath, 'utf8')

    await expect(runPromotion(seedPath, packsDir)).rejects.toThrow(/validatePublishedClosure/)
    expect(fs.readFileSync(seedPath, 'utf8')).toBe(before)
    expect(fs.existsSync(packsDir)).toBe(false)
  })
})

describe('dryRunReport (--dry-run)', () => {
  it('reports would-be counts and no shortfall when D9 is met', () => {
    const r = dryRunReport(graphWithEightCoveredDims())
    expect(r.promotedAssociations).toBe(8)
    expect(r.expandedConcepts).toBe(1)
    expect(r.closureOk).toBe(true)
    expect(r.shortfalls.find((s) => s.conceptId === 'c_0001')).toBeUndefined()
  })

  it('lists a concept short on degree and dimensions, with reasons', () => {
    const g = graphWithEightCoveredDims()
    g.associations = g.associations.slice(0, 4) // categoria + 3 more: deg 4, dim 4
    const r = dryRunReport(g)
    expect(r.expandedConcepts).toBe(0)
    const s = r.shortfalls.find((x) => x.conceptId === 'c_0001')
    expect(s).toMatchObject({ degree: 4, dimensions: 4, reasons: ['deg<8', 'dim<5'] })
  })

  it('flags a missing categoria', () => {
    const g = graphWithEightCoveredDims()
    g.associations = g.associations.slice(1, 6) // no categoria: deg 5, dim 5
    const s = dryRunReport(g).shortfalls.find((x) => x.conceptId === 'c_0001')
    expect(s).toMatchObject({ degree: 5, dimensions: 5, reasons: ['deg<8', 'cat=false'] })
  })

  it('ignores concepts below the reporting-degree floor', () => {
    const g = graphWithEightCoveredDims()
    g.associations = g.associations.slice(0, 3) // deg 3 < MIN_VALIDATED_ASSOCIATES
    expect(dryRunReport(g).shortfalls.find((x) => x.conceptId === 'c_0001')).toBeUndefined()
  })

  it('surfaces a closure failure without throwing', () => {
    const g = graphWithEightCoveredDims()
    g.associations = []
    g.concepts.c_0001.status_fronteira = 'expanded'
    const r = dryRunReport(g)
    expect(r.closureOk).toBe(false)
    expect(r.closureIssues.length).toBeGreaterThan(0)
  })
})

