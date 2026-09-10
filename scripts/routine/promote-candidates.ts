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
import {
  EXPANDED_MIN_DEGREE,
  EXPANDED_MIN_DIMENSIONS,
  EXPANDED_REQUIRED_DIMENSION,
  MIN_VALIDATED_ASSOCIATES,
} from '../../src/model/v04/config'
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

/** Primary-sense lemma for a concept, for readable dry-run output. */
function lemmaOf(graph: PublishedGraph, conceptId: string): string {
  for (const sense of Object.values(graph.word_senses)) {
    if (sense.concept_id !== conceptId || !sense.is_primary) continue
    const lex = sense.lexeme_kind === 'word' ? graph.words[sense.lexeme_id] : graph.expressions[sense.lexeme_id]
    if (lex) return lex.display_form
  }
  return conceptId
}

export interface D9Shortfall {
  conceptId: string
  lemma: string
  degree: number
  dimensions: number
  /** any of: `deg<8`, `dim<5`, `cat=false` */
  reasons: string[]
}

export interface DryRunReport {
  promotedAssociations: number
  expandedConcepts: number
  closureOk: boolean
  closureIssues: { kind: string; detail: string }[]
  /** still-`needs_expansion` concepts with validated degree ≥ MIN_VALIDATED_ASSOCIATES
   * that still fall short of D9 after promotion — worth a look before merge. */
  shortfalls: D9Shortfall[]
}

/** Pure preview of what a merge would promote — the read-only counterpart of
 * `runPromotion`. Runs `promoteCandidates` (which never mutates the input) and
 * reads back the resulting graph; writes nothing. */
export function dryRunReport(seed: PublishedGraph): DryRunReport {
  const { graph, promotedAssociations, expandedConcepts } = promoteCandidates(seed)
  const closure = validatePublishedClosure(graph)
  const adj = buildValidatedAdjacency(graph)

  const shortfalls: D9Shortfall[] = []
  for (const [id, concept] of Object.entries(graph.concepts)) {
    if (concept.status_fronteira !== 'needs_expansion') continue
    const degree = adj.degree.get(id) ?? 0
    if (degree < MIN_VALIDATED_ASSOCIATES) continue
    if (wouldBeExpanded(graph, id, adj)) continue
    const dims = adj.dimensions.get(id) ?? new Set<string>()
    const reasons: string[] = []
    if (degree < EXPANDED_MIN_DEGREE) reasons.push(`deg<${EXPANDED_MIN_DEGREE}`)
    if (dims.size < EXPANDED_MIN_DIMENSIONS) reasons.push(`dim<${EXPANDED_MIN_DIMENSIONS}`)
    if (!dims.has(EXPANDED_REQUIRED_DIMENSION)) reasons.push('cat=false')
    shortfalls.push({ conceptId: id, lemma: lemmaOf(graph, id), degree, dimensions: dims.size, reasons })
  }

  return {
    promotedAssociations,
    expandedConcepts,
    closureOk: closure.ok,
    closureIssues: closure.issues,
    shortfalls,
  }
}

function formatDryRun(r: DryRunReport): string {
  const lines = [
    `DRY RUN — would promote ${r.promotedAssociations} association(s), expand ${r.expandedConcepts} concept(s)`,
    `validatePublishedClosure: ${r.closureOk ? 'ok' : 'FAIL'}`,
    ...r.closureIssues.map((i) => `  [${i.kind}] ${i.detail}`),
    '',
    `still short of D9 (validated degree ≥ ${MIN_VALIDATED_ASSOCIATES}), ${r.shortfalls.length} concept(s):`,
    ...(r.shortfalls.length === 0
      ? ['  (none)']
      : r.shortfalls.map(
          (s) => `  ${s.conceptId} ${s.lemma.padEnd(18)} deg=${s.degree} dim=${s.dimensions}  ${s.reasons.join(' ')}`,
        )),
  ]
  return `${lines.join('\n')}\n`
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const isDryRun = argv.includes('--dry-run')
  const { seed: seedArg, packs: packsArg } = parseFlags(
    argv.filter((a) => a !== '--dry-run'),
    ['seed', 'packs'] as const,
  )
  const seedPath = seedArg ? path.resolve(seedArg) : DEFAULT_SEED_PATH
  const packsDir = packsArg ? path.resolve(packsArg) : DEFAULT_PACKS_DIR

  if (isDryRun) {
    const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as PublishedGraph
    process.stdout.write(formatDryRun(dryRunReport(seed)))
    return
  }

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
