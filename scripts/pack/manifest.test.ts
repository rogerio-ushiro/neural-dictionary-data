import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildPacks } from './build-packs'
import { writeManifest } from './manifest'
import type { PublishedGraph } from '../../src/model/v04/types'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndict-manifest-'))
})
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function writeGraph(dir: string, graph: PublishedGraph): string {
  const p = path.join(dir, 'graph.json')
  fs.writeFileSync(p, JSON.stringify(graph))
  return p
}

const graph: PublishedGraph = {
  meta: { language: 'it' },
  words: { w_0001: { display_form: 'mare', normalized_form: 'mare', pos: null }, w_0002: { display_form: 'acqua', normalized_form: 'acqua', pos: null } },
  expressions: {},
  word_senses: {
    s_0001: { lexeme_id: 'w_0001', lexeme_kind: 'word', concept_id: 'c_0001', is_primary: true },
    s_0002: { lexeme_id: 'w_0002', lexeme_kind: 'word', concept_id: 'c_0002', is_primary: true },
  },
  concepts: { c_0001: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' }, c_0002: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' } },
  associations: [{ concept_a: 'c_0001', concept_b: 'c_0002', relation_type: 'associata', direction_hint: 'symmetric', association_strength: 0.9, confidence: 1, status: 'validated', revision: 1 }],
  lexical_index: [
    { normalized_form: 'mare', lexeme_id: 'w_0001', lexeme_kind: 'word' },
    { normalized_form: 'acqua', lexeme_id: 'w_0002', lexeme_kind: 'word' },
  ],
  semantic_regions: {},
  expansion_queue: [],
  sync_state: { manifest_version: null, ready: false },
}

describe('writeManifest', () => {
  it('assigns version 1 to every pack on the first run', () => {
    const srcPath = writeGraph(tmpDir, graph)
    const packsDir = path.join(tmpDir, 'packs')
    buildPacks(srcPath, packsDir)
    const manifest = writeManifest(packsDir)
    expect(manifest.manifest_version).toBe(1)
    expect(manifest.packs.length).toBeGreaterThan(0)
    expect(manifest.packs.every((p) => p.version === 1)).toBe(true)
    expect(manifest.packs.map((p) => p.id)).toContain('global')
  })

  it('is idempotent: re-running over unchanged packs keeps the same versions', () => {
    const srcPath = writeGraph(tmpDir, graph)
    const packsDir = path.join(tmpDir, 'packs')
    buildPacks(srcPath, packsDir)
    const first = writeManifest(packsDir)
    const second = writeManifest(packsDir)
    expect(second).toEqual(first)
  })

  it('bumps only the changed pack version and the global manifest_version', () => {
    const srcPath = writeGraph(tmpDir, graph)
    const packsDir = path.join(tmpDir, 'packs')
    buildPacks(srcPath, packsDir)
    const before = writeManifest(packsDir)

    const changed: PublishedGraph = { ...graph, concepts: { ...graph.concepts, c_0001: { revision: 2, region_id: null, status_fronteira: 'expanded' } } }
    buildPacks(writeGraph(tmpDir, changed), packsDir)
    const after = writeManifest(packsDir)

    expect(after.manifest_version).toBe(before.manifest_version + 1)
    const beforeById = new Map(before.packs.map((p) => [p.id, p]))
    let bumped = 0
    for (const p of after.packs) {
      const b = beforeById.get(p.id)
      if (!b) continue
      if (b.hash !== p.hash) {
        expect(p.version).toBe(b.version + 1)
        bumped += 1
      } else {
        expect(p.version).toBe(b.version)
      }
    }
    expect(bumped).toBeGreaterThan(0)
  })
})
