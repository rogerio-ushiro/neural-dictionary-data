// Reconstructs the canonical PublishedGraph from a packs/ directory (Story 4,
// T4.6). A cross-shard association was written into both shards' bundles
// (build-packs.ts); this recombines them, keeping exactly one copy per
// canonical (concept_a, concept_b, relation_type) — so the result can be run
// through validateStructure, which is not shard-aware.

import fs from 'node:fs'
import path from 'node:path'
import type { Association, PublishedGraph } from '../../src/model/v04/types'
import type { GlobalPack, GraphShard } from '../../src/model/v04/wire'

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
}

function associationKey(a: Association): string {
  return `${a.concept_a}|${a.concept_b}|${a.relation_type}`
}

export function dedupeShards(packsDir: string): PublishedGraph {
  const graphDir = path.join(packsDir, 'graph')
  const shardFiles = fs.existsSync(graphDir) ? fs.readdirSync(graphDir).filter((f) => f.endsWith('.json')) : []

  const concepts: PublishedGraph['concepts'] = {}
  const wordSenses: PublishedGraph['word_senses'] = {}
  const words: PublishedGraph['words'] = {}
  const expressions: PublishedGraph['expressions'] = {}
  const seenAssociations = new Map<string, Association>()

  for (const file of shardFiles) {
    const shard = readJson<GraphShard>(path.join(graphDir, file))
    Object.assign(concepts, shard.concepts)
    Object.assign(wordSenses, shard.word_senses)
    Object.assign(words, shard.words)
    Object.assign(expressions, shard.expressions)
    for (const a of shard.associations) {
      // Both copies of a cross-shard association are byte-identical (same
      // source object serialised into each shard) — first one wins, others drop.
      seenAssociations.set(associationKey(a), a)
    }
  }

  const lexiconDir = path.join(packsDir, 'lexicon', 'it')
  const lexicalIndex: PublishedGraph['lexical_index'] = []
  if (fs.existsSync(lexiconDir)) {
    for (const file of fs.readdirSync(lexiconDir).filter((f) => f.endsWith('.json'))) {
      const pack = readJson<{ entries: { normalized_form: string; lexeme_id: string; lexeme_kind: 'word' | 'expression' }[] }>(
        path.join(lexiconDir, file),
      )
      for (const e of pack.entries) {
        lexicalIndex.push({ normalized_form: e.normalized_form, lexeme_id: e.lexeme_id, lexeme_kind: e.lexeme_kind })
      }
    }
  }

  const globalPath = path.join(packsDir, 'global.json')
  const global = fs.existsSync(globalPath)
    ? readJson<GlobalPack>(globalPath)
    : { meta: { language: 'it' as const }, semantic_regions: {}, expansion_queue: [], sync_state: { manifest_version: null, ready: false } }

  return {
    meta: global.meta,
    words,
    expressions,
    word_senses: wordSenses,
    concepts,
    associations: [...seenAssociations.values()],
    lexical_index: lexicalIndex,
    semantic_regions: global.semantic_regions,
    expansion_queue: global.expansion_queue,
    sync_state: global.sync_state,
  }
}
