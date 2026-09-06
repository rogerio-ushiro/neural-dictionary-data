// Incremental patches between two versions of the packs/ directory (Story 4,
// T4.3, spec §43: snapshot + delta). Only `graph.*` packs get fine-grained
// concept/association ops — a changed `lexicon.*` or `global` pack is small
// enough that the loader (T4.4) just re-fetches it whole when its manifest
// hash changes, so no patch is emitted for those.
//
// CLI: tsx scripts/pack/patch.ts --old dir --new dir
// Programmatic: writePatch(diffManifest(oldPacksDir, newPacksDir), newPacksDir)

import fs from 'node:fs'
import path from 'node:path'
import { isMainModule, parseFlags } from '../lib/cli'
import type { Association, Concept } from '../../src/model/v04/types'
import type { GraphShard, Manifest, Patch, PatchOp } from '../../src/model/v04/wire'

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
}

function readManifest(packsDir: string): Manifest | null {
  const p = path.join(packsDir, 'manifest.json')
  return fs.existsSync(p) ? readJson<Manifest>(p) : null
}

function readShard(packsDir: string, bucket: string): GraphShard {
  const p = path.join(packsDir, 'graph', `${bucket}.json`)
  if (!fs.existsSync(p)) return { shard: bucket, concepts: {}, associations: [], word_senses: {}, words: {}, expressions: {} }
  return readJson<GraphShard>(p)
}

function conceptsEqual(a: Concept, b: Concept): boolean {
  return (
    a.revision === b.revision &&
    a.region_id === b.region_id &&
    a.status_fronteira === b.status_fronteira &&
    // `definition` is an object re-parsed from JSON on each side, so `===` never
    // holds — compare by value. A definition change also bumps `revision`
    // (definitions/apply.ts), so this is defense-in-depth for hand edits.
    a.definition?.text === b.definition?.text &&
    a.definition?.example === b.definition?.example
  )
}

function associationKey(a: Association): string {
  return `${a.concept_a}|${a.concept_b}|${a.relation_type}`
}

function associationsEqual(a: Association, b: Association): boolean {
  return (
    a.association_strength === b.association_strength &&
    a.confidence === b.confidence &&
    a.status === b.status &&
    a.revision === b.revision &&
    a.direction_hint === b.direction_hint
  )
}

/** ops to turn `oldShard` into `newShard`. No REMOVE_CONCEPT (not in the D14
 * op vocabulary — a concept is retired via its associations, not deleted). */
export function diffShard(oldShard: GraphShard, newShard: GraphShard): PatchOp[] {
  const ops: PatchOp[] = []

  for (const [id, concept] of Object.entries(newShard.concepts)) {
    const before = oldShard.concepts[id]
    if (!before) ops.push({ op: 'ADD_CONCEPT', concept_id: id, concept })
    else if (!conceptsEqual(before, concept)) ops.push({ op: 'UPDATE_CONCEPT', concept_id: id, concept })
  }

  const oldByKey = new Map(oldShard.associations.map((a) => [associationKey(a), a]))
  const newByKey = new Map(newShard.associations.map((a) => [associationKey(a), a]))

  for (const [key, a] of newByKey) {
    const before = oldByKey.get(key)
    if (!before) ops.push({ op: 'ADD_ASSOCIATION', association: a })
    else if (!associationsEqual(before, a)) ops.push({ op: 'UPDATE_ASSOCIATION', association: a })
  }
  for (const [key, a] of oldByKey) {
    if (!newByKey.has(key)) ops.push({ op: 'REMOVE_ASSOCIATION', concept_a: a.concept_a, concept_b: a.concept_b, relation_type: a.relation_type })
  }

  return ops
}

/**
 * Diffs two packs/ directories at the manifest level. `oldPacksDir` may not
 * exist yet (first-ever run) — every pack is then treated as newly added, with
 * `from: 0`.
 */
export function diffManifest(oldPacksDir: string, newPacksDir: string): Patch[] {
  const oldManifest = readManifest(oldPacksDir)
  const newManifest = readManifest(newPacksDir)
  if (!newManifest) throw new Error(`no manifest.json in ${newPacksDir} — run writeManifest first`)

  const oldById = new Map((oldManifest?.packs ?? []).map((p) => [p.id, p]))
  const patches: Patch[] = []

  for (const pack of newManifest.packs) {
    if (!pack.id.startsWith('graph.')) continue
    const before = oldById.get(pack.id)
    if (before && before.hash === pack.hash) continue // unchanged, no patch needed

    const bucket = pack.id.replace(/^graph\./, '')
    const oldShard = before ? readShard(oldPacksDir, bucket) : { shard: bucket, concepts: {}, associations: [], word_senses: {}, words: {}, expressions: {} }
    const newShard = readShard(newPacksDir, bucket)
    const ops = diffShard(oldShard, newShard)
    if (ops.length > 0) patches.push({ pack: pack.id, from: before?.version ?? 0, to: pack.version, ops })
  }

  return patches
}

export function writePatch(patches: Patch[], packsDir: string): void {
  for (const patch of patches) {
    const dir = path.join(packsDir, 'patches', patch.pack)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${patch.from}-${patch.to}.json`), `${JSON.stringify(patch, null, 2)}\n`)
  }
}

async function main(): Promise<void> {
  const { old: oldArg, new: newArg } = parseFlags(process.argv.slice(2), ['old', 'new'] as const)
  if (!oldArg || !newArg) throw new Error('usage: patch.ts --old <dir> --new <dir>')

  const patches = diffManifest(path.resolve(oldArg), path.resolve(newArg))
  writePatch(patches, path.resolve(newArg))
  process.stdout.write(`OK — ${patches.length} pack(s) patched\n`)
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${(err as Error).stack ?? err}\n`)
    process.exit(1)
  })
}
