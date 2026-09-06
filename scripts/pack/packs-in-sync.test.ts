// T4.8 — CI guard: the committed public/data/ must be exactly what
// `buildPacks(seed/graph.json)` produces today, and manifest.json's hashes
// must match the committed pack files. Catches "edited packs by hand" or
// "regenerated packs but forgot to commit/re-manifest" drift.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildPacks } from './build-packs'
import { computeManifest } from './manifest'

const ROOT = path.resolve(__dirname, '../..')
const SEED_PATH = path.join(ROOT, 'src/data/v04/seed/graph.json')
const COMMITTED_PACKS_DIR = path.join(ROOT, 'public/data')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndict-packs-sync-'))
afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

function listFilesRecursive(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFilesRecursive(full, base))
    else if (entry.name !== 'manifest.json' && !full.includes(`${path.sep}patches${path.sep}`)) {
      out.push(path.relative(base, full))
    }
  }
  return out.sort()
}

describe('packs-in-sync (T4.8)', () => {
  it('the committed seed exists', () => {
    expect(fs.existsSync(SEED_PATH)).toBe(true)
  })

  it('rebuilding from seed/graph.json produces byte-identical pack files', () => {
    buildPacks(SEED_PATH, tmpDir)

    const fresh = listFilesRecursive(tmpDir)
    const committed = listFilesRecursive(COMMITTED_PACKS_DIR)
    expect(fresh).toEqual(committed) // same file set, e.g. no orphaned/missing shard

    const diffs: string[] = []
    for (const rel of fresh) {
      const a = fs.readFileSync(path.join(tmpDir, rel), 'utf8')
      const b = fs.readFileSync(path.join(COMMITTED_PACKS_DIR, rel), 'utf8')
      if (a !== b) diffs.push(rel)
    }
    expect(diffs).toEqual([])
  })

  it("manifest.json's hashes match the committed pack files' actual content", () => {
    const manifestPath = path.join(COMMITTED_PACKS_DIR, 'manifest.json')
    expect(fs.existsSync(manifestPath)).toBe(true)
    const committedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

    const recomputed = computeManifest(COMMITTED_PACKS_DIR, committedManifest)
    const byId = (m: typeof committedManifest) => new Map(m.packs.map((p: { id: string; hash: string }) => [p.id, p.hash]))
    expect(byId(recomputed)).toEqual(byId(committedManifest))
  })
})
