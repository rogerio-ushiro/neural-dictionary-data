// classify stage (T5.2, spec §14): normalises each candidate's relation_type,
// flags whether it's in the known working set (D1), and fills in a missing
// `confidence` (D12) — the **one** place that default is applied, so every
// later stage (and every AssociationSource — file, subagent, API) can rely on
// `confidence` always being a real number without re-implementing the default.
// Doesn't drop or reject anything — an unknown relation_type is a signal for
// the coverage/design docs to notice a taxonomy gap (Story 1's
// `validateStructure` also only warns on this, never errors), not a failure.

import { DEFAULT_CANDIDATE_CONFIDENCE, isKnownRelationType } from '../../../src/model/v04/config'
import type { RawCandidate } from '../contract'

export interface ClassifiedCandidate extends RawCandidate {
  relation_type: string // re-declared: normalised (trimmed), not the raw source string
  confidence: number // re-declared: always present now (RawCandidate's is optional)
  knownRelationType: boolean
}

export function classify(candidates: RawCandidate[]): ClassifiedCandidate[] {
  return candidates.map((c) => {
    const relation_type = c.relation_type.trim()
    return {
      ...c,
      relation_type,
      confidence: c.confidence ?? DEFAULT_CANDIDATE_CONFIDENCE,
      knownRelationType: isKnownRelationType(relation_type),
    }
  })
}
