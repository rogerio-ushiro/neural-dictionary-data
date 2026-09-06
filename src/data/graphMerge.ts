// Browser-safe reconstruction of a PublishedGraph from fetched packs (T4.4).
// Same logic as scripts/pack/dedupe.ts (Story 4, T4.6), ported off `fs` so it
// can run in the client: a cross-shard association was written into both
// shards' bundles by buildPacks — this recombines them, keeping exactly one
// copy per canonical (concept_a, concept_b, relation_type).

import type { Association, PublishedGraph } from '../model/v04/types'
import type { GlobalPack, GraphShard, LexiconPack } from '../model/v04/wire'

function associationKey(a: Association): string {
  return `${a.concept_a}|${a.concept_b}|${a.relation_type}`
}

export interface FetchedPacks {
  global: GlobalPack
  shards: GraphShard[]
  lexiconPacks: LexiconPack[]
}

export function mergeGraph({ global, shards, lexiconPacks }: FetchedPacks): PublishedGraph {
  const concepts: PublishedGraph['concepts'] = {}
  const wordSenses: PublishedGraph['word_senses'] = {}
  const words: PublishedGraph['words'] = {}
  const expressions: PublishedGraph['expressions'] = {}
  const seenAssociations = new Map<string, Association>()

  for (const shard of shards) {
    Object.assign(concepts, shard.concepts)
    Object.assign(wordSenses, shard.word_senses)
    Object.assign(words, shard.words)
    Object.assign(expressions, shard.expressions)
    // Both copies of a cross-shard association are byte-identical (same source
    // object serialised into each shard) — first one wins, others drop.
    for (const a of shard.associations) seenAssociations.set(associationKey(a), a)
  }

  const lexicalIndex: PublishedGraph['lexical_index'] = []
  for (const pack of lexiconPacks) {
    for (const e of pack.entries) {
      lexicalIndex.push({ normalized_form: e.normalized_form, lexeme_id: e.lexeme_id, lexeme_kind: e.lexeme_kind })
    }
  }

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
