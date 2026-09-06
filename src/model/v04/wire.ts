// Wire shapes for the offline-first distribution layer (Story 4). Transport
// types, not the core model itself — packs are a sharded serialisation of one
// PublishedGraph. Lives in src/model/v04/ (not scripts/) so both the Node
// build scripts (scripts/pack/*) and the browser loader (src/data/loader.ts)
// import the exact same definitions instead of duplicating them.

import type { Association, Concept, Expression, LexemeKind, SemanticRegion, SyncState, Word, WordSense } from './types'

/** One structural shard `graph/<bucket>.json` (schema/v04/graph-shard.schema.json).
 * Carries its concepts, every association touching them (a cross-shard
 * association is duplicated into both shards' bundles — see dedupe.ts), and the
 * words/expressions/senses whose primary sense's concept lives in this shard. */
export interface GraphShard {
  shard: string
  concepts: Record<string, Concept>
  associations: Association[]
  word_senses: Record<string, WordSense>
  words: Record<string, Word>
  expressions: Record<string, Expression>
}

/** The graph-global entities that don't belong to any one shard: too small and
 * too cross-cutting to fatten every shard with a copy. Its own pack, id `global`. */
export interface GlobalPack {
  meta: { language: 'it'; manifest_version?: number }
  semantic_regions: Record<string, SemanticRegion>
  expansion_queue: { concept_id: string; expansion_priority: number }[]
  sync_state: SyncState
}

/** One autocomplete pack `lexicon/it/<prefix>.json` (schema/v04/lexicon-pack.schema.json). */
export interface LexiconPack {
  prefix: string
  entries: {
    normalized_form: string
    lexeme_id: string
    lexeme_kind: LexemeKind
    display_form: string
  }[]
}

export interface ManifestPackEntry {
  id: string
  version: number
  hash: string
}

export interface Manifest {
  manifest_version: number
  packs: ManifestPackEntry[]
}

export type PatchOp =
  | { op: 'ADD_CONCEPT'; concept_id: string; concept: Concept }
  | { op: 'UPDATE_CONCEPT'; concept_id: string; concept: Concept }
  | { op: 'ADD_ASSOCIATION'; association: Association }
  | { op: 'UPDATE_ASSOCIATION'; association: Association }
  | { op: 'REMOVE_ASSOCIATION'; concept_a: string; concept_b: string; relation_type: string }

/** snapshot+delta between two versions of one pack (spec §43). Only `graph.*`
 * packs get fine-grained ops — a changed `lexicon.*` or `global` pack is small
 * enough that the client just re-fetches it whole (see patch.ts). */
export interface Patch {
  pack: string
  from: number
  to: number
  ops: PatchOp[]
}
