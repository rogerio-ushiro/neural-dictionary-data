// Single source of truth for the v0.4 numeric/enumerable parameters decided in
// prose in Story 1 (docs modelo-cognitive-v04.md, taxonomia-relazioni.md).

import type { AssociationStatus, Pos } from './types'

// --- D1: relation-type working set — the 15 §7 dimensions + `associata` +
// `sinonimo`. `relation_type` is a free string in the schema; this is only the
// *known* set. validateStructure warns (not errors) on a type outside it, so the
// Story 5 classifier can try new types without breaking the build.

export const RELATION_TYPE_WORKING_SET = [
  'categoria',
  'costituzione',
  'parti',
  'contenuto',
  'proprietà',
  'fenomeni',
  'azioni',
  'oggetti',
  'luoghi',
  'esseri_viventi',
  'cause',
  'effetti',
  'similarità',
  'contrasto',
  'evocativa',
  'associata', // migration default (v0.3 data carries only `faixa`)
  'sinonimo', // human-applied only (edit-associations); not a §7 dimension, not proposed by the generator
] as const

export type KnownRelationType = (typeof RELATION_TYPE_WORKING_SET)[number]

const RELATION_TYPE_SET: ReadonlySet<string> = new Set(RELATION_TYPE_WORKING_SET)

export function isKnownRelationType(t: string): boolean {
  return RELATION_TYPE_SET.has(t)
}

/**
 * The subset the generation pipeline is allowed to propose (D12/D15). `sinonimo`
 * is excluded: synonym edges are marked by hand via `edit-associations`, never
 * emitted by the model — leaking it into the prompt would have the generator tag
 * every near-synonym as `sinonimo` on every concept.
 */
export const GENERATED_RELATION_TYPES: readonly string[] = RELATION_TYPE_WORKING_SET.filter(
  (t) => t !== 'sinonimo',
)

/**
 * Symmetric relation types (spec §7.13–15) — the UI phrases them without a
 * direction. Everything else is conceptually directional but still stored on the
 * canonical `concept_a < concept_b` pair (D2); this set only informs display.
 */
export const SYMMETRIC_RELATION_TYPES: ReadonlySet<string> = new Set([
  'similarità',
  'contrasto',
  'evocativa',
  'associata',
  'sinonimo',
])

/**
 * Order the pipeline investigates dimensions in (spec §8): fundamental first.
 * The 15 semantic dimensions of §7 — a deliberate subset of
 * RELATION_TYPE_WORKING_SET (it excludes the non-§7 members `associata` and
 * `sinonimo`). Coverage analysis and D9 (frontier.ts) treat this as the full set
 * of dimensions.
 */
export const RELATION_INVESTIGATION_ORDER: readonly string[] = [
  'categoria',
  'costituzione',
  'parti',
  'contenuto',
  'proprietà',
  'esseri_viventi',
  'fenomeni',
  'azioni',
  'oggetti',
  'luoghi',
  'cause',
  'effetti',
  'similarità',
  'contrasto',
  'evocativa',
]

// --- Association status ---

export const ASSOCIATION_STATUSES: readonly AssociationStatus[] = [
  'candidate',
  'validated',
  'rejected',
  'deprecated',
]

// --- Part of speech (D5) ---

export const POS_VALUES: readonly Exclude<Pos, null>[] = [
  'sostantivo',
  'verbo',
  'aggettivo',
  'avverbio',
  'locuzione',
]

// --- D7: fixed semantic regions (spec §26). Internal governance metric only,
// never shown in the UI. `region_id` is the key, `label` the display string.

export const REGIONS: Readonly<Record<string, string>> = {
  r_corpo: 'corpo',
  r_cibo: 'cibo',
  r_casa: 'casa',
  r_natura: 'natura',
  r_animali: 'animali',
  r_movimento: 'movimento',
  r_lavoro: 'lavoro',
  r_citta: 'città',
  r_oggetti: 'oggetti',
  r_emozioni: 'emozioni',
  r_tempo: 'tempo',
  r_relazioni_sociali: 'relazioni_sociali',
  r_azioni: 'azioni',
  r_qualita: 'qualità',
  r_concetti_astratti: 'concetti_astratti',
}

// --- Display: how many associates the ego graph shows (central concept + TOP_N).
// Carried over unchanged from v0.3.

export const TOP_N = 8

/**
 * Ring radius for an associate, as a continuous function of its
 * `association_strength` (0..1). Stronger = closer. No discrete bands (D3).
 * Units are arbitrary; the camera frames the whole ego view.
 */
export const RING_RADIUS_NEAR = 110
export const RING_RADIUS_FAR = 320

export function strengthToRadius(strength: number): number {
  const s = Math.min(1, Math.max(0, strength))
  return RING_RADIUS_FAR - s * (RING_RADIUS_FAR - RING_RADIUS_NEAR)
}

/**
 * Display-only 3-way bucketing of `association_strength`, for GraphView's node
 * size/colour (Story 3, T3.4) — the v0.3 palette (`--nd-node-forte/media/
 * debole`) stays visually unchanged, so this isn't part of the persisted model.
 * Thresholds mirror v0.3's old FAIXA_CUTOFFS, which is also exactly what the
 * migration mapped `forte/media/debole` to (0.9/0.65/0.4) — so migrated data
 * renders in the same band it always did.
 */
export type StrengthBand = 'forte' | 'media' | 'debole'

export function strengthToBand(strength: number): StrengthBand {
  if (strength >= 0.82) return 'forte'
  if (strength >= 0.55) return 'media'
  return 'debole'
}

// --- D8: expansion_priority = weighted sum of 4 factors (no budget cap).
// priority = w_coverage·coverage_gap + w_relation·relation_gap
//          + w_frontier·graph_frontier_value + w_depth·depth_factor
// `novelty_potential` (spec §18) and `lexical_value` are out of the MVP.

export const EXPANSION_PRIORITY_WEIGHTS = {
  coverage_gap: 0.4,
  relation_gap: 0.3,
  graph_frontier_value: 0.2,
  depth_factor: 0.1,
} as const

/**
 * A concept with fewer than this many `validated` associations is considered to
 * still need expansion (minimal predicate — see frontier.ts / D9). The rich
 * exit criterion (dimension coverage + marginal gain) lands in Story 5.
 */
export const MIN_VALIDATED_ASSOCIATES = 4

// --- D9: rich needs_expansion → expanded criterion (frontier.ts `wouldBeExpanded`).
// A concept is "adequately covered" (spec §10/§11) once it has enough validated
// associations AND spans enough of the 15 §7 dimensions, including the one the
// spec treats as always-fundamental ("what is it" — spec §8 puts it first).

export const EXPANDED_MIN_DEGREE = 8 // mirrors ASSOCIATION_COUNT_HINTS.min, declared below
export const EXPANDED_MIN_DIMENSIONS = 5
export const EXPANDED_REQUIRED_DIMENSION = 'categoria'

// --- D11: pipeline auto-rejection (Story 5). Mechanical errors (duplicate,
// self-loop) are always rejected; a candidate below this confidence is too,
// leaving genuine quality judgement — "does this actually make sense" — to the
// human reviewing the PR (Story 7), not automated.

export const LOW_CONFIDENCE_THRESHOLD = 0.5

// --- D12: a subagent-authored candidate may omit `confidence`; this is what it
// defaults to (scripts/generate/contract.ts).

export const DEFAULT_CANDIDATE_CONFIDENCE = 0.85

/**
 * Reference targets for how many associations a concept should end up with
 * (spec §9). Not goals — safety/cost bounds. The gap-loop stop criterion
 * (Story 5) tunes these against real output.
 */
export const ASSOCIATION_COUNT_HINTS = { min: 8, common: 24, ceiling: 50 } as const
