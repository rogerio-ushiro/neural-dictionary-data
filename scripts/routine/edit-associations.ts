// Edits existing associations in the seed graph: retype / reweight / deprecate.
// The generation pipeline (publish.ts) is strictly additive and resolveDedup
// rejects any pair+type already present (at any status) — so lowering a
// template edge's strength, changing its relation_type, or retiring it can only
// be done by editing the seed JSON directly. This is the only path for that;
// never go through finish-batch to touch an existing edge.
//
// CLI: tsx scripts/routine/edit-associations.ts --edits <path> [--seed path] [--packs dir]
//
// Edit-list JSON: [{ concept_a, concept_b, relation_type, op, to_type?, to_strength? }]
//   op "reweight"  → association_strength = to_strength (0 < x ≤ 1), bump revision
//   op "retype"    → drop the row, add one with relation_type = to_type (pair and
//                    concept_a/concept_b order preserved exactly), bump revision.
//                    Aborts if (pair, to_type) already exists — that would be a
//                    duplicate-association (validate.ts).
//   op "deprecate" → status = 'deprecated', bump revision. One-way vs the dedup:
//                    a deprecated pair+type can't be re-authored by finish-batch.
//
// Re-packs public/data the same way finish-batch/promote-candidates do (snapshot
// old → rebuild → diff → write patch), so an edit ships as an incremental patch.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule, parseFlags } from '../lib/cli'
import { validateStructure } from '../../src/model/v04/validate'
import type { Association, PublishedGraph } from '../../src/model/v04/types'
import { buildPacks } from '../pack/build-packs'
import { writeManifest } from '../pack/manifest'
import { diffManifest, writePatch } from '../pack/patch'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_SEED_PATH = path.join(HERE, '../../src/data/v04/seed/graph.json')
const DEFAULT_PACKS_DIR = path.join(HERE, '../../public/data')

export type EditOp = 'reweight' | 'retype' | 'deprecate'

export interface AssociationEdit {
  concept_a: string
  concept_b: string
  relation_type: string
  op: EditOp
  /** required for op "retype" */
  to_type?: string
  /** required for op "reweight" */
  to_strength?: number
}

export interface EditAssociationsOptions {
  seedPath?: string
  packsDir?: string
}

export interface EditAssociationsResult {
  counts: Record<EditOp, number>
  patchedPacks: number
  changedPaths: string[]
}

function key(a: string, b: string, type: string): string {
  return `${a}|${b}|${type}`
}

/** Canonical order (Association invariant: concept_a < concept_b). */
function canonical(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x]
}

/** Applies every edit in order to `graph.associations` in place. Throws (graph
 * left half-edited — caller must not persist) on a missing target, a bad param,
 * or a retype collision. */
export function applyEdits(graph: PublishedGraph, edits: AssociationEdit[]): Record<EditOp, number> {
  const counts: Record<EditOp, number> = { reweight: 0, retype: 0, deprecate: 0 }
  const byKey = new Map<string, Association>()
  for (const a of graph.associations) byKey.set(key(a.concept_a, a.concept_b, a.relation_type), a)

  edits.forEach((edit, i) => {
    const [ca, cb] = canonical(edit.concept_a, edit.concept_b)
    const at = `edit ${i} (${ca}, ${cb}, ${edit.relation_type}) ${edit.op}`
    const target = byKey.get(key(ca, cb, edit.relation_type))
    if (!target) throw new Error(`${at}: no such association in the seed`)

    if (edit.op === 'reweight') {
      const s = edit.to_strength
      if (typeof s !== 'number' || !(s > 0) || s > 1) throw new Error(`${at}: to_strength must be in (0, 1], got ${s}`)
      target.association_strength = s
      target.revision += 1
      counts.reweight += 1
    } else if (edit.op === 'deprecate') {
      target.status = 'deprecated'
      target.revision += 1
      counts.deprecate += 1
    } else if (edit.op === 'retype') {
      const to = edit.to_type
      if (typeof to !== 'string' || to.length === 0) throw new Error(`${at}: to_type is required`)
      if (to === edit.relation_type) throw new Error(`${at}: to_type equals the current relation_type`)
      if (byKey.has(key(ca, cb, to))) throw new Error(`${at}: (${ca}, ${cb}, ${to}) already exists — would duplicate`)
      const replacement: Association = { ...target, relation_type: to, revision: target.revision + 1 }
      const idx = graph.associations.indexOf(target)
      graph.associations.splice(idx, 1, replacement)
      byKey.delete(key(ca, cb, edit.relation_type))
      byKey.set(key(ca, cb, to), replacement)
      counts.retype += 1
    } else {
      throw new Error(`${at}: unknown op`)
    }
  })

  return counts
}

export async function editAssociations(
  edits: AssociationEdit[],
  opts: EditAssociationsOptions = {},
): Promise<EditAssociationsResult> {
  const seedPath = opts.seedPath ?? DEFAULT_SEED_PATH
  const packsDir = opts.packsDir ?? DEFAULT_PACKS_DIR

  const graph = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as PublishedGraph
  const counts = applyEdits(graph, edits)

  const structure = validateStructure(graph)
  if (!structure.ok) {
    throw new Error(
      `edits produced a structurally invalid graph — seed left untouched:\n` +
        structure.issues.map((issue) => `  [${issue.kind}] ${issue.detail}`).join('\n'),
    )
  }

  // Snapshot the packs before overwriting, so the change ships as a patch.
  const oldPacksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndict-old-packs-'))
  if (fs.existsSync(packsDir)) fs.cpSync(packsDir, oldPacksDir, { recursive: true })

  fs.writeFileSync(seedPath, `${JSON.stringify(graph, null, 2)}\n`)
  buildPacks(seedPath, packsDir)
  writeManifest(packsDir)
  const patches = diffManifest(oldPacksDir, packsDir)
  writePatch(patches, packsDir)
  fs.rmSync(oldPacksDir, { recursive: true, force: true })

  return { counts, patchedPacks: patches.length, changedPaths: [seedPath, packsDir] }
}

function parseEditList(raw: unknown): AssociationEdit[] {
  if (!Array.isArray(raw)) throw new Error('edit-list must be a JSON array')
  return raw.map((e, i) => {
    const edit = e as Partial<AssociationEdit>
    if (typeof edit.concept_a !== 'string' || typeof edit.concept_b !== 'string' || typeof edit.relation_type !== 'string') {
      throw new Error(`edit ${i}: concept_a, concept_b and relation_type are required strings`)
    }
    if (edit.op !== 'reweight' && edit.op !== 'retype' && edit.op !== 'deprecate') {
      throw new Error(`edit ${i}: op must be reweight | retype | deprecate`)
    }
    return edit as AssociationEdit
  })
}

async function main(): Promise<void> {
  const { edits: editsArg, seed: seedArg, packs: packsArg } = parseFlags(
    process.argv.slice(2),
    ['edits', 'seed', 'packs'] as const,
  )
  if (!editsArg) throw new Error('usage: edit-associations.ts --edits <path> [--seed path] [--packs dir]')

  const edits = parseEditList(JSON.parse(fs.readFileSync(path.resolve(editsArg), 'utf8')))
  const result = await editAssociations(edits, {
    seedPath: seedArg ? path.resolve(seedArg) : undefined,
    packsDir: packsArg ? path.resolve(packsArg) : undefined,
  })
  const { reweight, retype, deprecate } = result.counts
  process.stdout.write(
    `OK — ${reweight} reweight, ${retype} retype, ${deprecate} deprecate; ` +
      `${result.patchedPacks} pack(s) patched. git add: ${result.changedPaths.join(', ')}\n`,
  )
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${(err as Error).stack ?? err}\n`)
    process.exit(1)
  })
}
