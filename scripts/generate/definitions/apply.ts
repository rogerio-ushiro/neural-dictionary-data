// Merges the definition input files into src/data/v04/seed/graph.json
// (Epic word-definition-modal, T3.2).
//
//   tsx scripts/generate/definitions/apply.ts [--seed path] [--data dir] [--dry-run]
//
// - backs the seed up to .local-backups/ before writing (skipped on --dry-run)
// - sets concepts[cid].definition and bumps concepts[cid].revision, but ONLY
//   for concepts whose text/example actually changed (idempotent re-runs)
// - never touches associations, status_fronteira, region_id or any other field
// - runs validateStructure on the result and writes nothing if it has issues
//   (malformed inputs are already dropped by readDefinitionInputs, so this only
//   fires on a pre-existing seed problem)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule, parseFlags } from '../../lib/cli'
import { validateStructure } from '../../../src/model/v04/validate'
import type { PublishedGraph } from '../../../src/model/v04/types'
import { readDefinitionInputs } from './file-source'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_SEED_PATH = path.join(HERE, '../../../src/data/v04/seed/graph.json')
const BACKUP_DIR = path.join(HERE, '../../../.local-backups')

export interface ApplyResult {
  changed: string[]
  unchanged: string[]
  missingConcept: string[]
  invalidInputs: { file: string; reason: string }[]
  backupPath: string | null
  wrote: boolean
}

export interface ApplyOptions {
  seedPath?: string
  dataDir?: string
  /** Where the pre-write seed backup lands. Defaults to repo `.local-backups/`. */
  backupDir?: string
  dryRun?: boolean
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export function applyDefinitions(opts: ApplyOptions = {}): ApplyResult {
  const seedPath = opts.seedPath ?? DEFAULT_SEED_PATH
  const graph = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as PublishedGraph

  const { valid, invalid } = readDefinitionInputs(opts.dataDir)

  const changed: string[] = []
  const unchanged: string[] = []
  const missingConcept: string[] = []

  for (const { concept_id, text, example } of valid) {
    const concept = graph.concepts[concept_id]
    if (!concept) {
      missingConcept.push(concept_id)
      continue
    }
    if (concept.definition?.text === text && concept.definition?.example === example) {
      unchanged.push(concept_id)
      continue
    }
    concept.definition = { text, example }
    concept.revision += 1
    changed.push(concept_id)
  }

  const res = validateStructure(graph)
  if (!res.ok) {
    const detail = res.issues.slice(0, 5).map((i) => `${i.kind}: ${i.detail}`).join('; ')
    throw new Error(`seed would be invalid after apply — nothing written. First issues: ${detail}`)
  }

  let backupPath: string | null = null
  let wrote = false
  if (!opts.dryRun && changed.length > 0) {
    const backupDir = opts.backupDir ?? BACKUP_DIR
    fs.mkdirSync(backupDir, { recursive: true })
    backupPath = path.join(backupDir, `backup_pre_definitions_${timestamp()}.json`)
    fs.copyFileSync(seedPath, backupPath)
    fs.writeFileSync(seedPath, `${JSON.stringify(graph, null, 2)}\n`)
    wrote = true
  }

  return { changed, unchanged, missingConcept, invalidInputs: invalid, backupPath, wrote }
}

if (isMainModule(import.meta.url)) {
  const flags = parseFlags(process.argv.slice(2).filter((a) => a !== '--dry-run'), ['seed', 'data'])
  const dryRun = process.argv.includes('--dry-run')
  const r = applyDefinitions({ seedPath: flags.seed, dataDir: flags.data, dryRun })

  for (const { file, reason } of r.invalidInputs) process.stderr.write(`  ! ${file}: ${reason}\n`)
  for (const cid of r.missingConcept) process.stderr.write(`  ! ${cid}: no such concept in seed — skipped\n`)

  process.stdout.write(
    `${dryRun ? '[dry-run] ' : ''}definitions: ${r.changed.length} changed, ${r.unchanged.length} unchanged, ` +
      `${r.missingConcept.length} missing-concept, ${r.invalidInputs.length} invalid input(s)\n`,
  )
  if (r.wrote) process.stdout.write(`  seed written; backup at ${r.backupPath}\n`)
}
