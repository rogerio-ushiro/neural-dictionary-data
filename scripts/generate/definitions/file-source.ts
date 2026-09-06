// Reads the definition input files for the backfill (Epic word-definition-modal,
// T3.1). One file per concept: scripts/generate/definitions/data/<concept_id>.json
// = { "concept_id": "c_0001", "text": "...", "example": "..." }.
//
// Kept a SEPARATE module (and a separate directory) from
// scripts/generate/file-source.ts on purpose: that one reads association-source
// files keyed by folded lemma, an incompatible shape, and scripts/routine/
// finish-batch.ts globs its directory for `git add`. Keying by concept_id here
// also sidesteps any future normalized_form collision.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const DEFINITIONS_DATA_DIR = path.join(HERE, 'data')

const CONCEPT_ID_RE = /^c_[0-9]{4,}$/

export interface DefinitionInput {
  concept_id: string
  text: string
  example: string
}

export interface InvalidInput {
  file: string
  reason: string
}

export interface ReadResult {
  valid: DefinitionInput[]
  invalid: InvalidInput[]
}

function validate(raw: unknown, fileBase: string): DefinitionInput | string {
  if (typeof raw !== 'object' || raw === null) return 'not a JSON object'
  const o = raw as Record<string, unknown>
  const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
  if (!nonEmpty(o.concept_id)) return 'missing/empty "concept_id"'
  if (!CONCEPT_ID_RE.test(o.concept_id)) return `"concept_id" not a c_NNNN id: ${o.concept_id}`
  // The file name is the source of truth for which concept this is.
  if (o.concept_id !== fileBase) return `"concept_id" ${o.concept_id} does not match file name ${fileBase}`
  if (!nonEmpty(o.text)) return 'missing/empty "text"'
  if (!nonEmpty(o.example)) return 'missing/empty "example"'
  return { concept_id: o.concept_id, text: o.text.trim(), example: o.example.trim() }
}

/** Reads every `*.json` in `dir` (default DEFINITIONS_DATA_DIR). Never throws on
 * a bad file — collects it in `invalid` so the caller can report and skip. A
 * missing directory yields an empty result. */
export function readDefinitionInputs(dir: string = DEFINITIONS_DATA_DIR): ReadResult {
  let entries: string[]
  try {
    entries = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  } catch {
    return { valid: [], invalid: [] }
  }

  const valid: DefinitionInput[] = []
  const invalid: InvalidInput[] = []
  const seen = new Set<string>()

  for (const file of entries) {
    const full = path.join(dir, file)
    const fileBase = file.replace(/\.json$/, '')
    let parsed: unknown
    try {
      parsed = JSON.parse(fs.readFileSync(full, 'utf8'))
    } catch (err) {
      invalid.push({ file, reason: `invalid JSON: ${(err as Error).message}` })
      continue
    }
    const result = validate(parsed, fileBase)
    if (typeof result === 'string') {
      invalid.push({ file, reason: result })
      continue
    }
    if (seen.has(result.concept_id)) {
      invalid.push({ file, reason: `duplicate concept_id ${result.concept_id}` })
      continue
    }
    seen.add(result.concept_id)
    valid.push(result)
  }

  return { valid, invalid }
}
