// Graph health metrics (spec §33–34, T6.1). Pure and React-free; reads a
// PublishedGraph and produces a report object. "Degree" throughout means
// **validated** associations touching the concept — consistent with the rest
// of the v0.4 model (closure, frontier_debt): candidate edges aren't truth yet.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule, parseFlags } from '../lib/cli'
import { MIN_VALIDATED_ASSOCIATES, POS_VALUES, RELATION_TYPE_WORKING_SET } from '../../src/model/v04/config'
import { validateStructure } from '../../src/model/v04/validate'
import type { AssociationStatus, PublishedGraph } from '../../src/model/v04/types'

export interface GraphHealthReport {
  conceptCount: number
  associationCount: number
  meanValidatedDegree: number
  medianValidatedDegree: number
  /** % of concepts with fewer than MIN_VALIDATED_ASSOCIATES validated associates. */
  pctThin: number
  /** % of concepts marked `expanded` — the model's own definition of "adequately covered". */
  pctAdequateCoverage: number
  relationTypeDistribution: Record<string, number>
  /** Part-of-speech distribution over words + expressions combined (spec §28). */
  lexicalClassDistribution: Record<string, number>
  /** % of concepts with a non-null region_id (spec §26). */
  pctRegionAssigned: number
  regionDistribution: Record<string, number>
  associationStatusDistribution: Record<AssociationStatus, number>
  duplicateAssociations: number
  /** nº of concepts still status_fronteira: needs_expansion (spec §34). */
  frontierDebt: number
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function pct(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 1000) / 10
}

export function computeGraphHealth(graph: PublishedGraph): GraphHealthReport {
  const conceptIds = Object.keys(graph.concepts)
  const conceptCount = conceptIds.length

  const validatedDegree = new Map<string, number>()
  const relationTypeDistribution: Record<string, number> = {}
  const associationStatusDistribution: Record<AssociationStatus, number> = {
    candidate: 0,
    validated: 0,
    rejected: 0,
    deprecated: 0,
  }

  for (const a of graph.associations) {
    associationStatusDistribution[a.status] += 1
    if (a.status !== 'validated') continue
    validatedDegree.set(a.concept_a, (validatedDegree.get(a.concept_a) ?? 0) + 1)
    validatedDegree.set(a.concept_b, (validatedDegree.get(a.concept_b) ?? 0) + 1)
    relationTypeDistribution[a.relation_type] = (relationTypeDistribution[a.relation_type] ?? 0) + 1
  }

  const degrees = conceptIds.map((id) => validatedDegree.get(id) ?? 0)
  const thinCount = degrees.filter((d) => d < MIN_VALIDATED_ASSOCIATES).length
  const expandedCount = conceptIds.filter((id) => graph.concepts[id].status_fronteira === 'expanded').length
  const regionAssignedCount = conceptIds.filter((id) => graph.concepts[id].region_id !== null).length
  const frontierDebt = conceptIds.filter((id) => graph.concepts[id].status_fronteira === 'needs_expansion').length

  const regionDistribution: Record<string, number> = {}
  for (const id of conceptIds) {
    const regionId = graph.concepts[id].region_id
    if (regionId !== null) regionDistribution[regionId] = (regionDistribution[regionId] ?? 0) + 1
  }

  const lexicalClassDistribution: Record<string, number> = {}
  for (const pos of POS_VALUES) lexicalClassDistribution[pos] = 0
  lexicalClassDistribution.unknown = 0
  for (const lexeme of [...Object.values(graph.words), ...Object.values(graph.expressions)]) {
    const key = lexeme.pos ?? 'unknown'
    lexicalClassDistribution[key] = (lexicalClassDistribution[key] ?? 0) + 1
  }

  const duplicateAssociations = validateStructure(graph).issues.filter(
    (i) => i.kind === 'duplicate-association',
  ).length

  return {
    conceptCount,
    associationCount: graph.associations.length,
    meanValidatedDegree: Math.round(mean(degrees) * 100) / 100,
    medianValidatedDegree: median(degrees),
    pctThin: pct(thinCount, conceptCount),
    pctAdequateCoverage: pct(expandedCount, conceptCount),
    relationTypeDistribution,
    lexicalClassDistribution,
    pctRegionAssigned: pct(regionAssignedCount, conceptCount),
    regionDistribution,
    associationStatusDistribution,
    duplicateAssociations,
    frontierDebt,
  }
}

export function formatReport(report: GraphHealthReport, title = 'Graph health report'): string {
  const dist = (d: Record<string, number>): string =>
    Object.entries(d)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `| ${k} | ${v} |`)
      .join('\n') || '| _(none)_ | 0 |'

  const knownTypes = new Set<string>(RELATION_TYPE_WORKING_SET)
  const unknownTypes = Object.keys(report.relationTypeDistribution).filter((t) => !knownTypes.has(t))

  const lines: string[] = [
    `# ${title}`,
    '',
    '## Counts',
    '',
    `- concepts: ${report.conceptCount}`,
    `- associations: ${report.associationCount}`,
    `- mean validated degree: ${report.meanValidatedDegree}`,
    `- median validated degree: ${report.medianValidatedDegree}`,
    `- % thin (< min validated associates): ${report.pctThin}%`,
    `- % adequate coverage (status_fronteira: expanded): ${report.pctAdequateCoverage}%`,
    `- % with a region assigned: ${report.pctRegionAssigned}%`,
    `- duplicate associations detected: ${report.duplicateAssociations}`,
    `- frontier_debt (needs_expansion): ${report.frontierDebt}`,
  ]
  if (unknownTypes.length > 0) {
    lines.push(`- ⚠ relation_type outside the working set: ${unknownTypes.join(', ')}`)
  }
  lines.push(
    '',
    '## relation_type distribution',
    '',
    '| type | count |',
    '|---|---|',
    dist(report.relationTypeDistribution),
    '',
    '## Lexical class distribution (words + expressions)',
    '',
    '| pos | count |',
    '|---|---|',
    dist(report.lexicalClassDistribution),
    '',
    '## Region distribution',
    '',
    '| region_id | count |',
    '|---|---|',
    dist(report.regionDistribution),
    '',
    '## Association status distribution',
    '',
    '| status | count |',
    '|---|---|',
    dist(report.associationStatusDistribution),
    '',
    '_Note: "new concepts / relations accepted-rejected per cycle" (spec §33) needs a snapshot to',
    'compare against — meaningful once the Story 7 routine has run at least once._',
    '',
  )
  return lines.join('\n')
}

// --- CLI (T6.2): tsx scripts/metrics/graph-health.ts [--in path] [--out path] ---

const HERE = path.dirname(fileURLToPath(import.meta.url))

async function main(): Promise<void> {
  const { in: inArg, out: outArg } = parseFlags(process.argv.slice(2), ['in', 'out'] as const)
  const inPath = inArg ? path.resolve(inArg) : path.join(HERE, '../../src/data/v04/seed/graph.json')
  const outPath = outArg ? path.resolve(outArg) : path.join(HERE, 'report.md')

  const graph = JSON.parse(fs.readFileSync(inPath, 'utf8')) as PublishedGraph
  const report = computeGraphHealth(graph)
  fs.writeFileSync(outPath, `${formatReport(report, `Graph health — ${path.basename(inPath)}`)}\n`)
  process.stdout.write(
    `OK — ${report.conceptCount} concepts, frontier_debt=${report.frontierDebt} -> ${outPath}\n`,
  )
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${(err as Error).stack ?? err}\n`)
    process.exit(1)
  })
}
