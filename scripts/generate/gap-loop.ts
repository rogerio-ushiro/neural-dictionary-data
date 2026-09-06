// gap-loop (T5.3, spec §11, resolves D9's *rich* exit criterion together with
// src/model/v04/frontier.ts `wouldBeExpanded`).
//
// The spec's stop criterion is iterative — generate, evaluate, generate again
// for the remaining gaps, until useful output drops below a threshold. With a
// file-backed source (D15's default) there is no live "ask for more" — one
// `runPipeline` call is inherently **one round** per concept. So here "the
// loop" degenerates honestly to: did this round clear the marginal-gain bar,
// and — if its survivors were hypothetically validated — would the concept now
// satisfy D9? Both are reported, neither is persisted: only Story 7's
// merge-time step (over the real post-merge validated graph) actually flips
// `status_fronteira`. A concept that "stopped" here just stays in the
// `expansion_queue` for a future run with fresher source data.

import { wouldBeExpanded } from '../../src/model/v04/frontier'
import { normalizeForm } from '../../src/model/v04/text'
import type { Association, PublishedGraph } from '../../src/model/v04/types'
import type { EvaluatedCandidate } from './stages/relevance'

/** Fewer than this many surviving candidates this round = no point asking
 * again right now (spec §11's marginal-gain stop, single-round proxy). */
export const MARGINAL_GAIN_MIN = 1

export interface GapLoopResult {
  concept_id: string
  usefulCount: number
  rejectedCount: number
  stopped: boolean
  wouldSatisfyD9IfValidated: boolean
}

/** Builds a throwaway graph — `graph` plus this concept's survivors treated as
 * `validated` — purely to preview `wouldBeExpanded`. Never written to disk;
 * placeholder ids for brand-new targets are fine here (wouldBeExpanded only
 * needs them as distinct opaque strings). */
function previewGraph(graph: PublishedGraph, conceptId: string, survivors: EvaluatedCandidate[]): PublishedGraph {
  const simulated: Association[] = survivors
    .filter((c) => c.status === 'candidate')
    .map((c) => {
      const targetId = c.targetConceptId ?? `NEW:${normalizeForm(c.lemma)}`
      const [a, b] = conceptId < targetId ? [conceptId, targetId] : [targetId, conceptId]
      return {
        concept_a: a,
        concept_b: b,
        relation_type: c.relation_type,
        association_strength: c.association_strength,
        confidence: c.confidence ?? 0,
        status: 'validated',
        revision: 1,
      }
    })
  return { ...graph, associations: [...graph.associations, ...simulated] }
}

export function evaluateGapLoop(
  graph: PublishedGraph,
  conceptId: string,
  survivors: EvaluatedCandidate[],
): GapLoopResult {
  const usefulCount = survivors.filter((c) => c.status === 'candidate').length
  const rejectedCount = survivors.length - usefulCount
  return {
    concept_id: conceptId,
    usefulCount,
    rejectedCount,
    stopped: usefulCount < MARGINAL_GAIN_MIN,
    wouldSatisfyD9IfValidated: wouldBeExpanded(previewGraph(graph, conceptId, survivors), conceptId),
  }
}
