// Frontier / expansion-debt helpers (spec §16–18, §27, §34). Pure and
// React-free. Used by the migration (Story 2), the health metrics (Story 6) and
// the generation pipeline (Story 5).

import {
  ASSOCIATION_COUNT_HINTS,
  EXPANDED_MIN_DEGREE,
  EXPANDED_MIN_DIMENSIONS,
  EXPANDED_REQUIRED_DIMENSION,
  EXPANSION_PRIORITY_WEIGHTS,
  MIN_VALIDATED_ASSOCIATES,
  RELATION_INVESTIGATION_ORDER,
  TOP_N,
} from './config'
import type { ExpansionQueueItem, PublishedGraph } from './types'

const HUB_DEGREE = 12
const DEPTH_SCALE = 4
const MAX_DEPTH = DEPTH_SCALE * 3

const INVESTIGATION_DIMENSIONS = new Set<string>(RELATION_INVESTIGATION_ORDER)

/**
 * Per-concept view of the `validated` sub-graph, built once and reused across
 * every concept (a rebuild-per-call scan is O(N·E) over the whole graph).
 */
export interface ValidatedAdjacency {
  /** concept id → ids of its distinct validated neighbours. */
  neighbours: Map<string, string[]>
  /** concept id → count of distinct validated neighbours. A pair with 2+
   * associations (one per relation_type — legal under D2) counts once here;
   * every one of those relation_types still lands in `dimensions`. */
  degree: Map<string, number>
  /** concept id → distinct §7 dimensions its validated associations cover. */
  dimensions: Map<string, Set<string>>
}

export function buildValidatedAdjacency(graph: PublishedGraph): ValidatedAdjacency {
  const neighbourSets = new Map<string, Set<string>>()
  const dimensions = new Map<string, Set<string>>()

  const link = (from: string, to: string, relationType: string): void => {
    const seen = neighbourSets.get(from)
    if (seen) seen.add(to)
    else neighbourSets.set(from, new Set([to]))
    if (INVESTIGATION_DIMENSIONS.has(relationType)) {
      const dims = dimensions.get(from)
      if (dims) dims.add(relationType)
      else dimensions.set(from, new Set([relationType]))
    }
  }

  for (const a of graph.associations) {
    if (a.status !== 'validated') continue
    link(a.concept_a, a.concept_b, a.relation_type)
    link(a.concept_b, a.concept_a, a.relation_type)
  }

  const neighbours = new Map<string, string[]>()
  const degree = new Map<string, number>()
  for (const [id, set] of neighbourSets) {
    neighbours.set(id, [...set])
    degree.set(id, set.size)
  }
  return { neighbours, degree, dimensions }
}

/**
 * Minimal predicate (D9): does this concept still need expansion, judging only
 * by current graph state? True when it has fewer than `MIN_VALIDATED_ASSOCIATES`
 * validated associates. Ignores the stored `status_fronteira` and any
 * `candidate` edges. The rich exit criterion (dimension coverage + marginal
 * gain) is layered on top in Story 5.
 */
export function needsExpansion(
  graph: PublishedGraph,
  conceptId: string,
  adj: ValidatedAdjacency = buildValidatedAdjacency(graph),
): boolean {
  return (adj.degree.get(conceptId) ?? 0) < MIN_VALIDATED_ASSOCIATES
}

/**
 * Coarse distance (BFS over validated edges) from `conceptId` to the nearest
 * "hub" (a concept with >= HUB_DEGREE validated associations). Input to the
 * depth factor of `expansionPriority` (spec §27). At ~1000 concepts this is a
 * weak signal — and on a graph with no hub yet it saturates at MAX_DEPTH for
 * every concept (see the PIANO "Diferido" note).
 */
export function conceptDepth(
  graph: PublishedGraph,
  conceptId: string,
  adj: ValidatedAdjacency = buildValidatedAdjacency(graph),
): number {
  if ((adj.degree.get(conceptId) ?? 0) >= HUB_DEGREE) return 0

  const seen = new Set<string>([conceptId])
  let frontier: string[] = [conceptId]
  for (let dist = 1; frontier.length > 0 && dist <= MAX_DEPTH; dist += 1) {
    const next: string[] = []
    for (const node of frontier) {
      for (const nb of adj.neighbours.get(node) ?? []) {
        if (seen.has(nb)) continue
        if ((adj.degree.get(nb) ?? 0) >= HUB_DEGREE) return dist
        seen.add(nb)
        next.push(nb)
      }
    }
    frontier = next
  }
  return MAX_DEPTH
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/**
 * expansion_priority = weighted sum of 4 normalised factors (D8). Higher =
 * expanded sooner. There is no budget cap — this only orders the queue.
 *
 * - coverage_gap        — how few validated relations the concept has
 * - relation_gap        — how many §7 dimensions are unrepresented
 * - graph_frontier_value— boost for freshly-discovered, barely-connected concepts
 * - depth_factor        — shallowness; favours horizontal over vertical growth
 */
export function expansionPriority(
  graph: PublishedGraph,
  conceptId: string,
  adj: ValidatedAdjacency = buildValidatedAdjacency(graph),
): number {
  const degree = adj.degree.get(conceptId) ?? 0
  const covered = adj.dimensions.get(conceptId)?.size ?? 0

  const coverage_gap = 1 - clamp01(degree / ASSOCIATION_COUNT_HINTS.common)
  const relation_gap =
    (RELATION_INVESTIGATION_ORDER.length - covered) / RELATION_INVESTIGATION_ORDER.length
  const graph_frontier_value = 1 - clamp01(degree / TOP_N)
  const depth_factor = 1 - clamp01(conceptDepth(graph, conceptId, adj) / MAX_DEPTH)

  const w = EXPANSION_PRIORITY_WEIGHTS
  return (
    w.coverage_gap * coverage_gap +
    w.relation_gap * relation_gap +
    w.graph_frontier_value * graph_frontier_value +
    w.depth_factor * depth_factor
  )
}

/**
 * The full `expansion_queue`: every concept whose **stored** `status_fronteira`
 * is `needs_expansion`, each with its `expansion_priority`, sorted
 * highest-priority first (ties broken by id for determinism). Builds the
 * validated-adjacency index once.
 *
 * The queue is gated on the *stored* field, not the minimal `needsExpansion()`
 * predicate: right after migration every concept is `needs_expansion` (none has
 * typed/covered relations yet), so the whole graph is in the queue. Story 5's
 * rich exit criterion (D9) is what flips a concept to `expanded` and drops it.
 */
export function computeExpansionQueue(graph: PublishedGraph): ExpansionQueueItem[] {
  const adj = buildValidatedAdjacency(graph)
  const items: ExpansionQueueItem[] = []
  for (const [conceptId, concept] of Object.entries(graph.concepts)) {
    if (concept.status_fronteira !== 'needs_expansion') continue
    items.push({ concept_id: conceptId, expansion_priority: expansionPriority(graph, conceptId, adj) })
  }
  items.sort((x, y) => y.expansion_priority - x.expansion_priority || x.concept_id.localeCompare(y.concept_id))
  return items
}

/**
 * D9 rich exit criterion: would this concept count as "adequately covered"
 * (spec §10/§11) if all its `candidate` associations were promoted to
 * `validated`? True when validated degree ≥ EXPANDED_MIN_DEGREE, it spans ≥
 * EXPANDED_MIN_DIMENSIONS of the §7 dimensions, and covers the always-required
 * one (`categoria`). Judges **validated** associations only — this is the same
 * predicate Story 7's merge-time step uses to actually flip `status_fronteira`
 * on the real post-merge graph; Story 5 uses it only to preview/report on a
 * temporary graph, never to persist the flip itself.
 */
export function wouldBeExpanded(
  graph: PublishedGraph,
  conceptId: string,
  adj: ValidatedAdjacency = buildValidatedAdjacency(graph),
): boolean {
  const degree = adj.degree.get(conceptId) ?? 0
  const dims = adj.dimensions.get(conceptId) ?? new Set<string>()
  return degree >= EXPANDED_MIN_DEGREE && dims.size >= EXPANDED_MIN_DIMENSIONS && dims.has(EXPANDED_REQUIRED_DIMENSION)
}
