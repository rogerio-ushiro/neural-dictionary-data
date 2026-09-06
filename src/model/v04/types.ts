// Cognitive Dictionary v0.4 data model. See docs modelo-cognitive-v04.md and
// taxonomia-relazioni.md. This module is React-free and the single source of
// truth for the published-graph shape; search, graph and the generation
// pipeline consume it. Entered additively alongside the v0.3 model (`../types`)
// — the v0.3 files are removed only in Story 8, after every consumer migrated.

// --- Opaque ids (D5). Plain string aliases (like the v0.3 `w_NNNN`) — kept as
// named types for readability, not branded: referential integrity is enforced by
// validateStructure + the JSON Schema, not the compiler. Values look like
// `w_0001` / `e_0001` / `s_0001` / `c_0001` / `r_natura`. ---

export type WordId = string
export type ExpressionId = string
export type SenseId = string
export type ConceptId = string
export type RegionId = string

/** Which lexical table a `WordSense` / `LexicalIndexEntry` points at. */
export type LexemeKind = 'word' | 'expression'

/** Part of speech (D5). `null` = unknown (all migrated entries). */
export type Pos =
  | 'sostantivo'
  | 'verbo'
  | 'aggettivo'
  | 'avverbio'
  | 'locuzione'
  | null

/** Association lifecycle (spec §13). */
export type AssociationStatus = 'candidate' | 'validated' | 'rejected' | 'deprecated'

/** Stored frontier state of a concept (spec §16). */
export type FrontierStatus = 'needs_expansion' | 'expanded'

/**
 * Display-only hint for how the UI phrases a symmetric association
 * ("mare → acqua" vs "acqua → mare"). Never used in traversal, uniqueness or
 * validation (D2). Migration writes `symmetric`.
 */
export type DirectionHint = 'a_to_b' | 'b_to_a' | 'symmetric'

// --- Lexical layer ---

/** A single-token lexical form. */
export interface Word {
  /** Shown in the UI, with accents: `città`. Non-empty. */
  display_form: string
  /** Accent/case-folded key for prefix search: `citta`. */
  normalized_form: string
  pos: Pos
}

/** A multi-word locution (D5), e.g. `al largo`. */
export interface Expression {
  display_form: string
  normalized_form: string
  /** Component words, when they exist as their own entries. May be empty. */
  component_word_ids: WordId[]
  pos: Pos
}

/**
 * The word↔concept junction (D4). Links one lexical entry (`word` OR
 * `expression`, per `lexeme_kind`) to one concept. A polysemous word would have
 * several; in the MVP every word has exactly one, with `is_primary: true`.
 */
export interface WordSense {
  lexeme_id: WordId | ExpressionId
  lexeme_kind: LexemeKind
  concept_id: ConceptId
  /** Short disambiguating gloss. Unused in the MVP. */
  gloss?: string
  is_primary: boolean
}

// --- Semantic layer ---

/**
 * Human-readable definition of a concept's sense. Italian free text, scoped to
 * the *concept* (its shown associates), not the bare lemma. Optional on the
 * graph — most concepts have none until the backfill runs — but when present
 * both fields are required and non-empty (enforced by graph.schema.json); a
 * half-written definition is a hard shape error, not a coverage gap.
 */
export interface ConceptDefinition {
  /** One defining sentence. */
  text: string
  /** One natural usage sentence. */
  example: string
}

/** A node of the graph. */
export interface Concept {
  revision: number
  /** Fixed §26 region (D7). `null` until the pipeline assigns one. */
  region_id: RegionId | null
  status_fronteira: FrontierStatus
  /** Absent until backfilled; see ConceptDefinition. Any mutation of it also
   * bumps `revision`, so patch diffing stays correct. */
  definition?: ConceptDefinition
}

/**
 * A symmetric, typed edge between two concepts (D1/D2/D3).
 * Invariant: `concept_a < concept_b` (string order); at most one association
 * per `(concept_a, concept_b, relation_type)`.
 */
export interface Association {
  concept_a: ConceptId
  concept_b: ConceptId
  /** Free string; `config.RELATION_TYPE_WORKING_SET` is the known set (D1). */
  relation_type: string
  direction_hint?: DirectionHint
  /** 0..1 — replaces the v0.3 `faixa`; drives the ego-graph ring radius. */
  association_strength: number
  /** 0..1 — pipeline/review gate. */
  confidence: number
  status: AssociationStatus
  revision: number
}

// --- Supporting entities ---

/** One fixed semantic region from spec §26 (D7). Internal governance only. */
export interface SemanticRegion {
  /** Human-readable label, e.g. `natura`, `cibo`. */
  label: string
}

/** Backs the autocomplete. Ordered alphabetically by `normalized_form` (D6). */
export interface LexicalIndexEntry {
  normalized_form: string
  lexeme_id: WordId | ExpressionId
  lexeme_kind: LexemeKind
}

/** One concept awaiting expansion, with its computed priority (spec §17–18). */
export interface ExpansionQueueItem {
  concept_id: ConceptId
  /** Weighted sum of 4 factors (D8). Higher = expanded sooner. No budget cap. */
  expansion_priority: number
}

/** Offline sync bookkeeping (Story 4). Present but minimal in Story 1. */
export interface SyncState {
  /** Manifest version the local cache was last reconciled against. */
  manifest_version: number | null
  /** Whether every shard is cached — the app is fully usable offline. */
  ready: boolean
}

// --- The published graph (pre-shard form; seed/ and candidate/) ---

export interface PublishedGraph {
  meta: { language: 'it'; manifest_version?: number }
  words: Record<string, Word>
  expressions: Record<string, Expression>
  word_senses: Record<string, WordSense>
  concepts: Record<string, Concept>
  associations: Association[]
  /** Inline (not a sibling file) so `candidate/graph.json` is self-contained. */
  lexical_index: LexicalIndexEntry[]
  semantic_regions: Record<string, SemanticRegion>
  expansion_queue: ExpansionQueueItem[]
  sync_state: SyncState
}

/** Direction-expanded association, produced by the in-memory adjacency index. */
export interface ConceptAssociation {
  target: ConceptId
  relation_type: string
  association_strength: number
  confidence: number
  status: AssociationStatus
}

export type AdjacencyIndex = Map<string, ConceptAssociation[]>
