// T7.2 — merge-time promotion: the ONLY place `status: candidate` becomes
// `validated` and `status_fronteira` flips to `expanded` (spec §13's
// "candidate/rejected" vs "verdade publicada"). Runs after a human merges the
// routine's PR (scripts/routine/expand-batch's output), never as part of
// generation itself (publish.ts, Story 5, never touches these fields).
//
// Uses the SAME wouldBeExpanded() predicate Story 5's gap-loop only *previews*
// with (src/model/v04/frontier.ts) — one definition of "adequately covered"
// (D9), evaluated for real here, on the actual post-merge validated graph.
//
// CLI: tsx scripts/routine/promote-candidates.ts [--seed path] [--packs dir]
// Fails loudly (exit 1, seed left untouched) if the promoted graph doesn't
// pass validatePublishedClosure — the merge should not have happened if a
// concept marked `expanded` still dead-ends.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule, parseFlags } from '../lib/cli'
import { buildValidatedAdjacency, wouldBeExpanded } from '../../src/model/v04/frontier'
import { validatePublishedClosure } from '../../src/model/v04/validate'
import type { PublishedGraph } from '../../src/model/v04/types'
import { buildPacks } from '../pack/build-packs'
import { writeManifest } from '../pack/manifest'
import { diffManifest, writePatch } from '../pack/patch'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_SEED_PATH = path.join(HERE, '../../src/data/v04/seed/graph.json')
const DEFAULT_PACKS_DIR = path.join(HERE, '../../public/data')

export interface PromoteResult {
  graph: PublishedGraph
  promotedAssociations: number
  expandedConcepts: number
  patchedPacks: number
}

/** Pure: promotes every `candidate` association to `validated` (bumping its
 * revision), then re-derives `status_fronteira` for every concept still
 * `needs_expansion` using the real (now-validated) data — D9's rich criterion,
 * evaluated for real here rather than previewed. Never demotes `expanded` back
 * to `needs_expansion` (a concept doesn't regress just because this cycle
 * added nothing new to it). */
export function promoteCandidates(seed: PublishedGraph): Omit<PromoteResult, 'patchedPacks'> {
  const graph: PublishedGraph = JSON.parse(JSON.stringify(seed))
  let promotedAssociations = 0

  for (const a of graph.associations) {
    if (a.status !== 'candidate') continue
    a.status = 'validated'
    a.revision += 1
    promotedAssociations += 1
  }

  const adj = buildValidatedAdjacency(graph)
  let expandedConcepts = 0
  for (const [id, concept] of Object.entries(graph.concepts)) {
    if (concept.status_fronteira !== 'needs_expansion') continue
    if (wouldBeExpanded(graph, id, adj)) {
      concept.status_fronteira = 'expanded'
      concept.revision += 1
      expandedConcepts += 1
    }
  }

  return { graph, promotedAssociations, expandedConcepts }
}

export async function runPromotion(seedPath: string, packsDir: string): Promise<PromoteResult> {
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as PublishedGraph
  const result = promoteCandidates(seed)

  const closure = validatePublishedClosure(result.graph)
  if (!closure.ok) {
    throw new Error(
      `promotion produced a graph that fails validatePublishedClosure — merge should not proceed:\n` +
        closure.issues.map((i) => `  [${i.kind}] ${i.detail}`).join('\n'),
    )
  }

  // Snapshot the packs as published before this promotion, so the change is
  // shipped as a patch (T4.3) rather than forcing every client to re-fetch
  // every touched shard whole — this is the one event (candidate → validated)
  // that mechanism exists for.
  const oldPacksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndict-old-packs-'))
  if (fs.existsSync(packsDir)) fs.cpSync(packsDir, oldPacksDir, { recursive: true })

  fs.writeFileSync(seedPath, `${JSON.stringify(result.graph, null, 2)}\n`)
  buildPacks(seedPath, packsDir)
  writeManifest(packsDir)
  const patches = diffManifest(oldPacksDir, packsDir)
  writePatch(patches, packsDir)
  fs.rmSync(oldPacksDir, { recursive: true, force: true })

  return { ...result, patchedPacks: patches.length }
}

async function main(): Promise<void> {
  const { seed: seedArg, packs: packsArg } = parseFlags(process.argv.slice(2), ['seed', 'packs'] as const)
  const seedPath = seedArg ? path.resolve(seedArg) : DEFAULT_SEED_PATH
  const packsDir = packsArg ? path.resolve(packsArg) : DEFAULT_PACKS_DIR

  const result = await runPromotion(seedPath, packsDir)
  process.stdout.write(
    `OK — ${result.promotedAssociations} association(s) validated, ${result.expandedConcepts} concept(s) expanded, ` +
      `${result.patchedPacks} pack(s) patched\n`,
  )
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${(err as Error).stack ?? err}\n`)
    process.exit(1)
  })
}
