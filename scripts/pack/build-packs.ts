// Splits a PublishedGraph into the offline-first distribution layer (Story 4,
// T4.1): structural shards (graph/NN), autocomplete packs (lexicon/it/XX), and
// one small graph-global pack for the entities no shard owns. D10: 256 shards
// (graph/00..ff) + 2-letter lexicon prefixes.
//
// CLI: tsx scripts/pack/build-packs.ts [--in path] [--out dir]
// Programmatic: buildPacks(srcGraphPath, outDir)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule, parseFlags } from '../lib/cli'
import type { PublishedGraph } from '../../src/model/v04/types'
import type { GlobalPack, GraphShard, LexiconPack } from '../../src/model/v04/wire'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const SHARD_COUNT = 256 // D10: graph/00..ff
const LEXICON_PREFIX_LEN = 2 // D10

/** FNV-1a 32-bit, deterministic across runs/platforms — unlike `String.hashCode`
 * folklore or Node's non-cryptographic hash APIs, which aren't guaranteed stable. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Deterministic bucket for a concept id, as a 2-digit lowercase hex string. */
export function shardBucket(conceptId: string): string {
  return (fnv1a(conceptId) % SHARD_COUNT).toString(16).padStart(2, '0')
}

/** Autocomplete pack prefix for a normalized_form (D10: first 2 chars, or the
 * whole thing if shorter). */
export function lexiconPrefix(normalizedForm: string): string {
  return normalizedForm.length <= LEXICON_PREFIX_LEN ? normalizedForm : normalizedForm.slice(0, LEXICON_PREFIX_LEN)
}

export interface BuildPacksResult {
  shards: Map<string, GraphShard>
  lexiconPacks: Map<string, LexiconPack>
  global: GlobalPack
}

export function buildPacksFromGraph(graph: PublishedGraph): BuildPacksResult {
  const conceptShard = new Map<string, string>()
  for (const conceptId of Object.keys(graph.concepts)) {
    conceptShard.set(conceptId, shardBucket(conceptId))
  }

  const shards = new Map<string, GraphShard>()
  const shardFor = (bucket: string): GraphShard => {
    const existing = shards.get(bucket)
    if (existing) return existing
    const created: GraphShard = { shard: bucket, concepts: {}, associations: [], word_senses: {}, words: {}, expressions: {} }
    shards.set(bucket, created)
    return created
  }

  for (const [conceptId, concept] of Object.entries(graph.concepts)) {
    shardFor(conceptShard.get(conceptId)!).concepts[conceptId] = concept
  }

  // Cross-shard association is duplicated into both shards' bundles (T1.4
  // exempts shard bundles from the canonical-uniqueness invariant; dedupe.ts
  // recombines them for validateStructure).
  for (const a of graph.associations) {
    const bucketA = conceptShard.get(a.concept_a)
    const bucketB = conceptShard.get(a.concept_b)
    if (bucketA) shardFor(bucketA).associations.push(a)
    if (bucketB && bucketB !== bucketA) shardFor(bucketB).associations.push(a)
  }

  // A word/expression lives in the shard of its *primary* sense's concept —
  // exactly one home, no duplication needed (only associations cross shards).
  for (const [senseId, sense] of Object.entries(graph.word_senses)) {
    if (!sense.is_primary) continue
    const bucket = conceptShard.get(sense.concept_id)
    if (!bucket) continue
    const shard = shardFor(bucket)
    shard.word_senses[senseId] = sense
    if (sense.lexeme_kind === 'word' && graph.words[sense.lexeme_id]) {
      shard.words[sense.lexeme_id] = graph.words[sense.lexeme_id]
    } else if (sense.lexeme_kind === 'expression' && graph.expressions[sense.lexeme_id]) {
      shard.expressions[sense.lexeme_id] = graph.expressions[sense.lexeme_id]
    }
  }

  const displayFormFor = (lexemeId: string, kind: 'word' | 'expression'): string =>
    (kind === 'word' ? graph.words[lexemeId] : graph.expressions[lexemeId])?.display_form ?? lexemeId

  const lexiconPacks = new Map<string, LexiconPack>()
  for (const entry of graph.lexical_index) {
    const prefix = lexiconPrefix(entry.normalized_form)
    let pack = lexiconPacks.get(prefix)
    if (!pack) {
      pack = { prefix, entries: [] }
      lexiconPacks.set(prefix, pack)
    }
    pack.entries.push({
      normalized_form: entry.normalized_form,
      lexeme_id: entry.lexeme_id,
      lexeme_kind: entry.lexeme_kind,
      display_form: displayFormFor(entry.lexeme_id, entry.lexeme_kind),
    })
  }
  for (const pack of lexiconPacks.values()) {
    pack.entries.sort((x, y) => x.normalized_form.localeCompare(y.normalized_form, 'it'))
  }

  const global: GlobalPack = {
    meta: graph.meta,
    semantic_regions: graph.semantic_regions,
    expansion_queue: graph.expansion_queue,
    sync_state: graph.sync_state,
  }

  return { shards, lexiconPacks, global }
}

/** Deterministic: same input graph always produces the same files (byte for
 * byte — stable key order, sorted lexicon entries), so a rebuild is safe to
 * diff against a committed `packs/` (T4.8). */
export function buildPacks(srcGraphPath: string, outDir: string): void {
  const graph = JSON.parse(fs.readFileSync(srcGraphPath, 'utf8')) as PublishedGraph
  const { shards, lexiconPacks, global } = buildPacksFromGraph(graph)

  const graphDir = path.join(outDir, 'graph')
  const lexiconDir = path.join(outDir, 'lexicon', 'it')
  fs.rmSync(graphDir, { recursive: true, force: true })
  fs.rmSync(lexiconDir, { recursive: true, force: true })
  fs.mkdirSync(graphDir, { recursive: true })
  fs.mkdirSync(lexiconDir, { recursive: true })

  // Write order doesn't affect content: each shard/pack is its own file,
  // independently deterministic (Map iteration order is already insertion
  // order, which is already deterministic given the same seed).
  for (const [bucket, shard] of shards) {
    fs.writeFileSync(path.join(graphDir, `${bucket}.json`), `${JSON.stringify(shard, null, 2)}\n`)
  }
  for (const [prefix, pack] of lexiconPacks) {
    fs.writeFileSync(path.join(lexiconDir, `${prefix}.json`), `${JSON.stringify(pack, null, 2)}\n`)
  }
  fs.writeFileSync(path.join(outDir, 'global.json'), `${JSON.stringify(global, null, 2)}\n`)
}

async function main(): Promise<void> {
  const { in: inArg, out: outArg } = parseFlags(process.argv.slice(2), ['in', 'out'] as const)
  const inPath = inArg ? path.resolve(inArg) : path.join(HERE, '../../src/data/v04/seed/graph.json')
  // public/ so Vite serves the packs at a stable same-origin URL (/data/...)
  // for the client loader (T4.4) — GitHub-raw as the fetch origin is deferred.
  const outDir = outArg ? path.resolve(outArg) : path.join(HERE, '../../public/data')
  buildPacks(inPath, outDir)
  process.stdout.write(`OK -> ${outDir}\n`)
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${(err as Error).stack ?? err}\n`)
    process.exit(1)
  })
}
