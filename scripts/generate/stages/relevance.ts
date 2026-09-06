// relevance stage (T5.2, D11): turns dedup.ts's flags plus a confidence cut
// into the auto-reject decision. Mechanical errors (self-loop, duplicate) and
// low-confidence candidates are marked `status: rejected` with a reason —
// *persisted*, not silently dropped (spec §13's "candidate/rejected" states;
// T6.1's associationStatusDistribution reports them). Everything else survives
// as `status: candidate`, left for human judgement in the PR (Story 7).

import { LOW_CONFIDENCE_THRESHOLD } from '../../../src/model/v04/config'
import type { ResolvedCandidate } from './dedup'

export type RejectReason = 'self-loop' | 'duplicate' | 'low-confidence'

export interface EvaluatedCandidate extends ResolvedCandidate {
  status: 'candidate' | 'rejected'
  rejectReason?: RejectReason
}

export function evaluateRelevance(candidates: ResolvedCandidate[]): EvaluatedCandidate[] {
  return candidates.map((c) => {
    if (c.isSelfLoop) return { ...c, status: 'rejected', rejectReason: 'self-loop' }
    if (c.isDuplicate) return { ...c, status: 'rejected', rejectReason: 'duplicate' }
    // c.confidence is always a real number by now — classify.ts applied
    // DEFAULT_CANDIDATE_CONFIDENCE to any candidate that arrived without one.
    if (c.confidence < LOW_CONFIDENCE_THRESHOLD) return { ...c, status: 'rejected', rejectReason: 'low-confidence' }
    return { ...c, status: 'candidate' }
  })
}
