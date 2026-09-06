// coverage stage (T5.2, spec §10): for one task, how many of the §7 dimensions
// are covered before vs. after adding this round's surviving candidates — plus
// a lexical-class tally of the new words/expressions proposed (spec §28). Pure
// report data; doesn't decide anything (gap-loop.ts does, from this + D9).

import { RELATION_INVESTIGATION_ORDER } from '../../../src/model/v04/config'
import type { GenerationTask } from '../contract'
import type { EvaluatedCandidate } from './relevance'

export interface CoverageReport {
  concept_id: string
  word: string
  coveredBefore: string[]
  coveredAfter: string[]
  missingAfter: string[]
  /** pos of every brand-new word/expression this round proposed for this concept. */
  newLexicalClasses: (string | null)[]
}

export function computeCoverage(task: GenerationTask, survivors: EvaluatedCandidate[]): CoverageReport {
  const covered = new Set(task.covered_relation_types)
  const newLexicalClasses: (string | null)[] = []

  for (const c of survivors) {
    if (c.status !== 'candidate') continue
    if (RELATION_INVESTIGATION_ORDER.includes(c.relation_type)) covered.add(c.relation_type)
    if (c.targetConceptId === null) newLexicalClasses.push(c.pos ?? null)
  }

  return {
    concept_id: task.concept_id,
    word: task.word,
    coveredBefore: task.covered_relation_types,
    coveredAfter: [...covered],
    missingAfter: RELATION_INVESTIGATION_ORDER.filter((r) => !covered.has(r)),
    newLexicalClasses,
  }
}
