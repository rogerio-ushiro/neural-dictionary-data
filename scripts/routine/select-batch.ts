// T7.1 — first half of the routine: picks the top-N concepts from
// expansion_queue and assembles their GenerationTask. This is the
// deterministic part; a Node script cannot itself propose good associations
// (that's the whole reason D15 makes the routine a Claude Code agent, not an
// API call) — this script's job is to hand the agent exactly what it needs to
// act on, nothing more.
//
// CLI: tsx scripts/routine/select-batch.ts [--n 10] [--seed path] [--out path]
// Output: a JSON array of GenerationTask, written to --out (default
// scripts/routine/.batch/tasks.json) for the agent to read.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule, parseFlags } from '../lib/cli'
import { buildGenerationTask, buildTaskContext, type GenerationTask } from '../generate/contract'
import { selectBatch as selectBatchIds } from '../generate/frontier'
import type { PublishedGraph } from '../../src/model/v04/types'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_SEED_PATH = path.join(HERE, '../../src/data/v04/seed/graph.json')
const DEFAULT_BATCH_SIZE = 10 // D13

export function selectBatch(graph: PublishedGraph, n: number = DEFAULT_BATCH_SIZE): GenerationTask[] {
  const ctx = buildTaskContext(graph)
  return selectBatchIds(graph, n).map((id) => buildGenerationTask(graph, id, ctx))
}

async function main(): Promise<void> {
  const { n: nArg, seed: seedArg, out: outArg } = parseFlags(process.argv.slice(2), ['n', 'seed', 'out'] as const)
  const seedPath = seedArg ? path.resolve(seedArg) : DEFAULT_SEED_PATH
  const outPath = outArg ? path.resolve(outArg) : path.join(HERE, '.batch/tasks.json')
  const n = nArg ? Number(nArg) : DEFAULT_BATCH_SIZE

  const graph = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as PublishedGraph
  const tasks = selectBatch(graph, n)

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(tasks, null, 2)}\n`)
  process.stdout.write(`OK — ${tasks.length} tasks (${tasks.map((t) => t.word).join(', ')}) -> ${outPath}\n`)
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${(err as Error).stack ?? err}\n`)
    process.exit(1)
  })
}
