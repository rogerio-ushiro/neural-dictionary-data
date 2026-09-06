// Coverage report for the definition backfill (Epic word-definition-modal, T3.3).
//
//   tsx scripts/generate/definitions/report.ts [--seed path] [--out path]
//
// Lists the concepts still missing a definition (with lemma + degree, so the
// batches in T4.1 can go widest-reach first) and, as cheap future-proofing, any
// normalized_form shared by two or more concepts. The region-disjointness idea
// was dropped: only ~2/1021 concepts carry a region_id in the current seed.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule, parseFlags } from '../../lib/cli'
import { buildPrimaryWordIndex } from '../../../src/model/v04/adjacency'
import type { PublishedGraph } from '../../../src/model/v04/types'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_SEED_PATH = path.join(HERE, '../../../src/data/v04/seed/graph.json')
const DEFAULT_OUT_PATH = path.join(HERE, 'report.md')

export interface MissingConcept {
  concept_id: string
  lemma: string
  degree: number
}

export interface NormalizedCollision {
  normalized_form: string
  concept_ids: string[]
}

export interface CoverageReport {
  total: number
  withDefinition: number
  missing: MissingConcept[]
  collisions: NormalizedCollision[]
}

export function buildCoverageReport(graph: PublishedGraph): CoverageReport {
  const words = buildPrimaryWordIndex(graph)

  const degree = new Map<string, number>()
  for (const a of graph.associations) {
    if (a.status !== 'validated') continue
    degree.set(a.concept_a, (degree.get(a.concept_a) ?? 0) + 1)
    degree.set(a.concept_b, (degree.get(a.concept_b) ?? 0) + 1)
  }

  const ids = Object.keys(graph.concepts)
  const withDefinition = ids.filter((cid) => graph.concepts[cid].definition !== undefined).length

  const missing: MissingConcept[] = ids
    .filter((cid) => graph.concepts[cid].definition === undefined)
    .map((cid) => ({ concept_id: cid, lemma: words.get(cid) ?? cid, degree: degree.get(cid) ?? 0 }))
    .sort((a, b) => b.degree - a.degree || a.concept_id.localeCompare(b.concept_id))

  // normalized_form -> concept ids reached through a primary sense
  const byNorm = new Map<string, Set<string>>()
  for (const sense of Object.values(graph.word_senses)) {
    if (!sense.is_primary) continue
    const lexeme = sense.lexeme_kind === 'word' ? graph.words[sense.lexeme_id] : graph.expressions[sense.lexeme_id]
    if (!lexeme) continue
    const set = byNorm.get(lexeme.normalized_form) ?? new Set<string>()
    set.add(sense.concept_id)
    byNorm.set(lexeme.normalized_form, set)
  }
  const collisions: NormalizedCollision[] = [...byNorm.entries()]
    .filter(([, set]) => set.size > 1)
    .map(([normalized_form, set]) => ({ normalized_form, concept_ids: [...set].sort() }))
    .sort((a, b) => a.normalized_form.localeCompare(b.normalized_form, 'it'))

  return { total: ids.length, withDefinition, missing, collisions }
}

export function formatReport(r: CoverageReport): string {
  const pct = r.total === 0 ? 0 : Math.round((r.withDefinition / r.total) * 1000) / 10
  const lines: string[] = [
    '# Definition backfill — coverage',
    '',
    `- concepts: **${r.total}**`,
    `- with definition: **${r.withDefinition}** (${pct}%)`,
    `- missing: **${r.missing.length}**`,
    `- normalized_form collisions: **${r.collisions.length}**`,
    '',
  ]

  if (r.collisions.length > 0) {
    lines.push('## normalized_form shared by 2+ concepts', '')
    for (const c of r.collisions) lines.push(`- \`${c.normalized_form}\` → ${c.concept_ids.join(', ')}`)
    lines.push('')
  }

  lines.push('## Missing a definition (widest reach first)', '')
  if (r.missing.length === 0) {
    lines.push('_none — full coverage._')
  } else {
    lines.push('| concept_id | lemma | degree |', '| --- | --- | --- |')
    for (const m of r.missing) lines.push(`| ${m.concept_id} | ${m.lemma} | ${m.degree} |`)
  }
  lines.push('')
  return lines.join('\n')
}

if (isMainModule(import.meta.url)) {
  const flags = parseFlags(process.argv.slice(2), ['seed', 'out'])
  const seedPath = flags.seed ?? DEFAULT_SEED_PATH
  const outPath = flags.out ?? DEFAULT_OUT_PATH
  const graph = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as PublishedGraph
  const report = buildCoverageReport(graph)
  fs.writeFileSync(outPath, formatReport(report))
  process.stdout.write(
    `coverage: ${report.withDefinition}/${report.total}, ${report.missing.length} missing, ` +
      `${report.collisions.length} collision(s) → ${outPath}\n`,
  )
}
