// Pipeline entry point (T5.6): classify → dedup → relevance → coverage →
// publish, then gap-loop reports on the result. Two ways in:
//
//   CLI:            tsx scripts/generate/index.ts --concepts c_0001,c_0002
//                   tsx scripts/generate/index.ts               (bootstraps from SEEDS)
//   Programmatic:   import { runPipeline } from './index'        (Story 7's routine)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule, parseFlags } from '../lib/cli'
import { computeExpansionQueue } from '../../src/model/v04/frontier'
import { normalizeForm } from '../../src/model/v04/text'
import type { PublishedGraph } from '../../src/model/v04/types'
import { buildGenerationTask, buildTaskContext, type AssociationSource } from './contract'
import { fileSource } from './file-source'
import { evaluateGapLoop, type GapLoopResult } from './gap-loop'
import { SEEDS } from './seed'
import { classify } from './stages/classify'
import { computeCoverage, type CoverageReport } from './stages/coverage'
import { buildDedupContext, resolveDedup } from './stages/dedup'
import { evaluateRelevance, type EvaluatedCandidate } from './stages/relevance'
import { publish, writeCandidateGraph } from './publish'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_SEED_PATH = path.join(HERE, '../../src/data/v04/seed/graph.json')
const DEFAULT_CANDIDATE_DIR = path.join(HERE, '../../src/data/v04/candidate')
const DEFAULT_BATCH_SIZE = 5

export interface PipelineOptions {
  seedPath?: string
  outDir?: string
  associationSource?: AssociationSource
}

export interface PipelineResult {
  outDir: string
  candidateCount: number
  rejectedCount: number
  droppedCount: number
  coverageReport: CoverageReport[]
  gapLoopReport: GapLoopResult[]
  queueDelta: { before: number; after: number }
}

/** conceptIds is the only required input — T7.1 (the routine) passes the top
 * of the expansion_queue; the CLI passes --concepts or falls back to SEEDS.
 * `opts.associationSource` is the D15 injection point (default: fileSource). */
export async function runPipeline(conceptIds: string[], opts: PipelineOptions = {}): Promise<PipelineResult> {
  const seedPath = opts.seedPath ?? DEFAULT_SEED_PATH
  const outDir = opts.outDir ?? DEFAULT_CANDIDATE_DIR
  const associationSource = opts.associationSource ?? fileSource

  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as PublishedGraph
  // Built once for the whole batch — not per concept (`seed` never changes
  // within a run) — and `seenInBatch` is the SAME Set across every concept, so
  // two different source concepts in this batch proposing the same target
  // pair+type get caught as a duplicate instead of both surviving and
  // colliding at publish time.
  const taskCtx = buildTaskContext(seed)
  const dedupCtx = buildDedupContext(seed)
  const seenInBatch = new Set<string>()

  const resultsByConceptId = new Map<string, EvaluatedCandidate[]>()
  const coverageReport: CoverageReport[] = []

  for (const conceptId of conceptIds) {
    const task = buildGenerationTask(seed, conceptId, taskCtx)
    const raw = await associationSource(task)
    const evaluated = evaluateRelevance(resolveDedup(dedupCtx, conceptId, classify(raw), seenInBatch))
    resultsByConceptId.set(conceptId, evaluated)
    coverageReport.push(computeCoverage(task, evaluated))
  }

  const outcome = publish(seed, resultsByConceptId)
  writeCandidateGraph(outcome, path.join(outDir, 'graph.json'))

  const gapLoopReport = conceptIds.map((id) => evaluateGapLoop(outcome.graph, id, resultsByConceptId.get(id) ?? []))

  let candidateCount = 0
  let rejectedCount = 0
  for (const s of outcome.stats.values()) {
    candidateCount += s.added
    rejectedCount += s.rejectedPersisted
  }

  return {
    outDir,
    candidateCount,
    rejectedCount,
    droppedCount: outcome.dropped.length,
    coverageReport,
    gapLoopReport,
    queueDelta: { before: computeExpansionQueue(seed).length, after: computeExpansionQueue(outcome.graph).length },
  }
}

/** Resolves each SEEDS lemma to its concept id via the seed graph. Skips a
 * lemma with no matching lexical_index entry (logs, doesn't throw). */
function resolveSeedConceptIds(seed: PublishedGraph): string[] {
  const ids: string[] = []
  for (const lemma of SEEDS) {
    const normalized = normalizeForm(lemma)
    const entry = seed.lexical_index.find((e) => e.normalized_form === normalized)
    if (!entry) continue
    const sense = Object.values(seed.word_senses).find(
      (s) => s.lexeme_id === entry.lexeme_id && s.lexeme_kind === entry.lexeme_kind && s.is_primary,
    )
    if (sense) ids.push(sense.concept_id)
  }
  return ids
}

function formatReport(result: PipelineResult): string {
  const lines = [
    '# Pipeline run report',
    '',
    `- candidates published: ${result.candidateCount}`,
    `- rejected (persisted, audit trail): ${result.rejectedCount}`,
    `- dropped (self-loop/duplicate/low-confidence-on-new, not persisted): ${result.droppedCount}`,
    `- expansion_queue size: ${result.queueDelta.before} → ${result.queueDelta.after}`,
    '',
    '## Coverage per concept',
    '',
    '| concept | word | covered before | covered after | missing after |',
    '|---|---|---|---|---|',
    ...result.coverageReport.map(
      (c) => `| ${c.concept_id} | ${c.word} | ${c.coveredBefore.length} | ${c.coveredAfter.length} | ${c.missingAfter.join(', ') || '—'} |`,
    ),
    '',
    '## Gap-loop (D9 preview — NOT persisted; Story 7 merge-time flips status_fronteira)',
    '',
    '| concept | useful | rejected | stopped | would satisfy D9 if validated |',
    '|---|---|---|---|---|',
    ...result.gapLoopReport.map(
      (g) => `| ${g.concept_id} | ${g.usefulCount} | ${g.rejectedCount} | ${g.stopped} | ${g.wouldSatisfyD9IfValidated} |`,
    ),
    '',
  ]
  return lines.join('\n')
}

async function main(): Promise<void> {
  const { concepts: conceptsArg, seed: seedArg, out: outArg, limit: limitArg } = parseFlags(
    process.argv.slice(2),
    ['concepts', 'seed', 'out', 'limit'] as const,
  )
  const seedPath = seedArg ? path.resolve(seedArg) : DEFAULT_SEED_PATH
  const outDir = outArg ? path.resolve(outArg) : DEFAULT_CANDIDATE_DIR

  let conceptIds: string[]
  if (conceptsArg) {
    conceptIds = conceptsArg.split(',').map((s) => s.trim()).filter(Boolean)
  } else {
    const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as PublishedGraph
    conceptIds = resolveSeedConceptIds(seed)
    const limit = limitArg ? Number(limitArg) : DEFAULT_BATCH_SIZE
    if (limit > 0) conceptIds = conceptIds.slice(0, limit)
  }

  if (conceptIds.length === 0) {
    process.stderr.write('no concept ids to run (empty --concepts, or none of SEEDS resolved)\n')
    process.exit(1)
  }

  const result = await runPipeline(conceptIds, { seedPath, outDir })
  fs.writeFileSync(path.join(outDir, 'report.md'), formatReport(result))
  process.stdout.write(
    `OK — ${result.candidateCount} candidates, ${result.rejectedCount} rejected, ${result.droppedCount} dropped -> ${outDir}\n`,
  )
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${(err as Error).stack ?? err}\n`)
    process.exit(1)
  })
}
