// File-backed AssociationSource (T5.7, D12, D15 default). Reads
// scripts/generate/data/<foldedLemma>.json — one file per generated concept,
// written by a subagent (or by hand for a demo/seed run).
//
// Format (v0.4): `[{ lemma, relation_type, association_strength, confidence?,
// pos?, region? }, ...]`. The ~110 files written for the v0.3 pipeline
// (`[{lemma, proximity}]`, no relation_type) are left untouched (D12) — this
// reader treats an entry missing relation_type/association_strength as
// **not yet regenerated** and skips it (warns, doesn't throw), rather than
// crashing the whole run over one stale file.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeForm } from '../../src/model/v04/text'
import type { GenerationTask, RawCandidate } from './contract'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = path.join(HERE, 'data')

export function fileKey(lemma: string): string {
  return normalizeForm(lemma).replace(/[^a-z0-9]+/g, '_')
}

function isV04Entry(entry: unknown): entry is RawCandidate {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as RawCandidate).lemma === 'string' &&
    typeof (entry as RawCandidate).relation_type === 'string' &&
    typeof (entry as RawCandidate).association_strength === 'number'
  )
}

export function fileSource(task: GenerationTask): RawCandidate[] {
  const file = path.join(DATA_DIR, `${fileKey(task.word)}.json`)
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return []
  }

  const parsed = JSON.parse(text) as unknown
  if (!Array.isArray(parsed)) throw new Error(`${file}: expected a JSON array`)

  // `confidence` is left as-is here (possibly absent) — classify.ts (the first
  // pipeline stage, run on every source's output alike) is the single place
  // that fills in the default.
  const skippedLegacy: unknown[] = []
  const candidates = parsed.flatMap((entry): RawCandidate[] => {
    if (isV04Entry(entry)) return [entry]
    skippedLegacy.push(entry)
    return []
  })

  if (skippedLegacy.length > 0) {
    process.stderr.write(
      `  ! ${file}: ${skippedLegacy.length} entr${skippedLegacy.length === 1 ? 'y' : 'ies'} in the pre-v0.4 ` +
        `format (no relation_type/association_strength) — skipped, not regenerated yet\n`,
    )
  }

  return candidates
}
