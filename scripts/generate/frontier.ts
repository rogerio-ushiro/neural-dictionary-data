// T5.4 — orchestration wrapper around src/model/v04/frontier.ts's
// computeExpansionQueue: picks the top-N concepts to expand this run. The
// actual priority math (D8, 4 factors, no budget cap) lives in the model —
// this file just derives the queue and slices it, the way any caller
// (CLI here, the Story 7 routine later) needs.

import { computeExpansionQueue } from '../../src/model/v04/frontier'
import type { ConceptId, PublishedGraph } from '../../src/model/v04/types'

export { computeExpansionQueue }

/** The `n` highest-priority concept ids still `needs_expansion`, ties broken
 * by id (see computeExpansionQueue). `n <= 0` returns the whole queue. */
export function selectBatch(graph: PublishedGraph, n: number): ConceptId[] {
  const queue = computeExpansionQueue(graph)
  const slice = n > 0 ? queue.slice(0, n) : queue
  return slice.map((item) => item.concept_id)
}
