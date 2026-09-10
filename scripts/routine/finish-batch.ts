// T7.1 — second half of the routine: runs once the agent has written
// scripts/generate/data/<lemma>.json for every task in the batch (D15/D12).
// Runs the pipeline, rebuilds the published packs, diffs them against the
// current commit's packs (patches), and promotes candidate/graph.json to
// seed/graph.json. Leaves `git add`/commit/push/PR to the caller — those are
// explicit-permission actions (spec-legal for a Claude Code agent to ask the
// user or, per D15, to perform as the routine itself; this script never shells
// out to git or `gh` on its own).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule, parseFlags } from '../lib/cli'
import type { AssociationSource } from '../generate/contract'
import { fileKey, DATA_DIR } from '../generate/file-source'
import { runPipeline, type PipelineResult } from '../generate/index'
import { buildPacks } from '../pack/build-packs'
import { writeManifest } from '../pack/manifest'
import { diffManifest, writePatch } from '../pack/patch'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_SEED_PATH = path.join(HERE, '../../src/data/v04/seed/graph.json')
const DEFAULT_CANDIDATE_DIR = path.join(HERE, '../../src/data/v04/candidate')
const DEFAULT_PACKS_DIR = path.join(HERE, '../../public/data')

export interface FinishBatchOptions {
  seedPath?: string
  candidateDir?: string
  packsDir?: string
  /** Default: fileSource (D15 production path — the agent already wrote the
   * data/<lemma>.json files). Injectable for tests. */
  associationSource?: AssociationSource
}

export interface FinishBatchResult {
  pipeline: PipelineResult
  patchedPacks: number
  /** Paths the caller should `git add` — everything this run touched. */
  changedPaths: string[]
}

export async function finishBatch(conceptIds: string[], opts: FinishBatchOptions = {}): Promise<FinishBatchResult> {
  const seedPath = opts.seedPath ?? DEFAULT_SEED_PATH
  const candidateDir = opts.candidateDir ?? DEFAULT_CANDIDATE_DIR
  const packsDir = opts.packsDir ?? DEFAULT_PACKS_DIR

  const pipeline = await runPipeline(conceptIds, { seedPath, outDir: candidateDir, associationSource: opts.associationSource })

  // Snapshot the packs as they are in the current commit, before overwriting —
  // diffManifest needs both "old" and "new" to exist as separate directories.
  const oldPacksDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndict-old-packs-'))
  fs.cpSync(packsDir, oldPacksDir, { recursive: true })

  const candidateGraphPath = path.join(candidateDir, 'graph.json')
  buildPacks(candidateGraphPath, packsDir)
  writeManifest(packsDir)
  const patches = diffManifest(oldPacksDir, packsDir)
  writePatch(patches, packsDir)
  fs.rmSync(oldPacksDir, { recursive: true, force: true })

  // Promote: the candidate graph (seed ∪ this batch, new associations still
  // `status: candidate`) becomes the new seed. Nothing here flips
  // status_fronteira or association status to `validated` — that's the
  // merge-time step (T7.2), run only after a human approves the PR.
  fs.copyFileSync(candidateGraphPath, seedPath)

  // The lemma files the agent wrote before calling this function (D15) belong
  // in the same PR — the design doc's review step diffs them alongside seed/
  // packs. Only the default fileSource route writes/reads these; an injected
  // associationSource (tests) leaves nothing to find, so the check is a no-op.
  const dataFiles = pipeline.coverageReport
    .map((c) => path.join(DATA_DIR, `${fileKey(c.word)}.json`))
    .filter((p) => fs.existsSync(p))

  return {
    pipeline,
    patchedPacks: patches.length,
    changedPaths: [seedPath, packsDir, ...new Set(dataFiles)],
  }
}

/** Per-concept lines from the pipeline's own reports — surfaces the numbers
 * runPipeline computes and otherwise only writes to report.md. `useful=0`
 * flags a concept whose data file was missing / all stale-format / produced
 * nothing; `D9=NO` flags a concept that won't be `expanded` on promotion. */
export function perConceptReport(pipeline: Pick<PipelineResult, 'coverageReport' | 'gapLoopReport'>): string {
  const gap = new Map(pipeline.gapLoopReport.map((g) => [g.concept_id, g]))
  const rows = pipeline.coverageReport.map((c) => {
    const g = gap.get(c.concept_id)
    return (
      `  ${c.concept_id} ${c.word.padEnd(18)} ` +
      `useful=${String(g?.usefulCount ?? 0).padStart(2)} ` +
      `cov ${c.coveredBefore.length}→${c.coveredAfter.length} ` +
      `D9=${g?.wouldSatisfyD9IfValidated ? 'yes' : 'NO '} ` +
      `missing[${c.missingAfter.join(',') || '—'}]`
    )
  })
  return `per concept:\n${rows.join('\n')}\n`
}

async function main(): Promise<void> {
  const { concepts } = parseFlags(process.argv.slice(2), ['concepts'] as const)
  if (!concepts) throw new Error('usage: finish-batch.ts --concepts c_0001,c_0002,...')
  const conceptIds = concepts.split(',').map((s) => s.trim()).filter(Boolean)

  const result = await finishBatch(conceptIds)
  process.stdout.write(perConceptReport(result.pipeline))
  process.stdout.write(
    `OK — ${result.pipeline.candidateCount} candidates, ${result.patchedPacks} pack(s) patched, ` +
      `seed promoted. git add: ${result.changedPaths.join(', ')}\n`,
  )
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${(err as Error).stack ?? err}\n`)
    process.exit(1)
  })
}
