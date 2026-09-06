import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeForm } from '../../src/model/v04/text'
import type { RawCandidate } from './contract'

// Persistent per-concept cache for the (dormant, D15) API source, so a re-run
// resumes instead of re-calling the API. Gitignored (scripts/generate/.gitignore).
const HERE = path.dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = path.join(HERE, '.cache')

function cacheFile(word: string): string {
  return path.join(CACHE_DIR, `${normalizeForm(word).replace(/[^a-z0-9]+/g, '_')}.json`)
}

export function readCache(word: string): RawCandidate[] | null {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(word), 'utf8')) as RawCandidate[]
  } catch {
    return null
  }
}

export function writeCache(word: string, data: RawCandidate[]): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(cacheFile(word), JSON.stringify(data, null, 2))
}
