// v0.4 validation, split in two (T1.4):
//
//  - validateStructure(graph)        shape + referential integrity + the
//                                    canonical-association invariants. Safe to
//                                    run on any batch — callers that validate a
//                                    generation batch pass `seed ∪ batch`.
//  - validatePublishedClosure(graph) the "no dead end" invariant. Only
//                                    meaningful on the merged/published graph.
//
// Structural problems are `issues` (ok = false). Soft problems the pipeline is
// allowed to carry (an unknown relation_type, a concept with no sense) are
// `warnings` and do not fail validation.

import Ajv from 'ajv'
import graphSchema from '../../../schema/v04/graph.schema.json'
import { RELATION_TYPE_WORKING_SET, TOP_N } from './config'
import type { PublishedGraph } from './types'

export interface ValidationIssue {
  kind: string
  detail: string
}

export interface ValidationResult {
  ok: boolean
  issues: ValidationIssue[]
  warnings: ValidationIssue[]
}

const ajv = new Ajv({ allErrors: true })
const validateShape = ajv.compile(graphSchema)

const KNOWN_RELATION_TYPES = new Set<string>(RELATION_TYPE_WORKING_SET)

function has(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

export function validateStructure(data: unknown): ValidationResult {
  const issues: ValidationIssue[] = []
  const warnings: ValidationIssue[] = []

  if (!validateShape(data)) {
    for (const err of validateShape.errors ?? []) {
      issues.push({ kind: 'shape', detail: `${err.instancePath || '/'} ${err.message ?? ''}`.trim() })
    }
    return { ok: false, issues, warnings }
  }

  const g = data as unknown as PublishedGraph

  // --- Referential integrity ---

  for (const [senseId, sense] of Object.entries(g.word_senses)) {
    if (!has(g.concepts, sense.concept_id)) {
      issues.push({ kind: 'dangling-sense-concept', detail: `${senseId} → ${sense.concept_id}` })
    }
    const lexTable = sense.lexeme_kind === 'word' ? g.words : g.expressions
    if (!has(lexTable, sense.lexeme_id)) {
      issues.push({ kind: 'dangling-sense-lexeme', detail: `${senseId} → ${sense.lexeme_id}` })
    }
  }

  for (const [wid, expr] of Object.entries(g.expressions)) {
    for (const cw of expr.component_word_ids) {
      if (!has(g.words, cw)) {
        issues.push({ kind: 'dangling-expression-component', detail: `${wid} → ${cw}` })
      }
    }
  }

  for (const [cid, concept] of Object.entries(g.concepts)) {
    if (concept.region_id !== null && !has(g.semantic_regions, concept.region_id)) {
      issues.push({ kind: 'dangling-concept-region', detail: `${cid} → ${concept.region_id}` })
    }
  }

  for (const item of g.expansion_queue) {
    if (!has(g.concepts, item.concept_id)) {
      issues.push({ kind: 'dangling-queue-concept', detail: item.concept_id })
    }
  }

  for (const entry of g.lexical_index) {
    const lexTable = entry.lexeme_kind === 'word' ? g.words : g.expressions
    if (!has(lexTable, entry.lexeme_id)) {
      issues.push({ kind: 'dangling-lexical-index', detail: entry.lexeme_id })
    }
  }

  // --- Association invariants (D2) ---

  const seenPairs = new Set<string>()
  for (const a of g.associations) {
    const label = `(${a.concept_a}, ${a.concept_b}, ${a.relation_type})`

    if (!has(g.concepts, a.concept_a) || !has(g.concepts, a.concept_b)) {
      issues.push({ kind: 'orphan-association-endpoint', detail: label })
      continue
    }
    if (a.concept_a === a.concept_b) {
      issues.push({ kind: 'self-loop', detail: label })
      continue
    }
    if (a.concept_a >= a.concept_b) {
      issues.push({ kind: 'association-not-canonical', detail: `${label}: expected concept_a < concept_b` })
    }

    const key = `${a.concept_a}|${a.concept_b}|${a.relation_type}`
    if (seenPairs.has(key)) {
      issues.push({ kind: 'duplicate-association', detail: label })
    }
    seenPairs.add(key)

    if (!KNOWN_RELATION_TYPES.has(a.relation_type)) {
      warnings.push({ kind: 'unknown-relation-type', detail: `${label}: not in working set` })
    }
  }

  // --- Soft: a concept nothing points a sense at is unreachable from search ---

  const conceptsWithSense = new Set<string>()
  for (const sense of Object.values(g.word_senses)) conceptsWithSense.add(sense.concept_id)
  for (const cid of Object.keys(g.concepts)) {
    if (!conceptsWithSense.has(cid)) {
      warnings.push({ kind: 'concept-without-sense', detail: cid })
    }
  }

  // --- Soft: a concept with no definition yet (coverage gap, not a defect —
  // a *malformed* definition is already a hard shape error above). ---

  for (const [cid, concept] of Object.entries(g.concepts)) {
    if (concept.definition === undefined) {
      warnings.push({ kind: 'concept-without-definition', detail: cid })
    }
  }

  return { ok: issues.length === 0, issues, warnings }
}

/**
 * "No dead end": every concept marked `expanded` must have at least one
 * `validated` associate within its shown TOP_N — i.e. the ego graph for it is
 * never empty. Concepts still `needs_expansion` are exempt (they are, by
 * definition, incomplete). Run only on the merged/published graph.
 */
export function validatePublishedClosure(data: unknown): ValidationResult {
  const structure = validateStructure(data)
  if (!structure.ok) return structure

  const g = data as unknown as PublishedGraph
  const issues: ValidationIssue[] = []

  const validatedByConcept = new Map<string, number>()
  for (const a of g.associations) {
    if (a.status !== 'validated') continue
    validatedByConcept.set(a.concept_a, (validatedByConcept.get(a.concept_a) ?? 0) + 1)
    validatedByConcept.set(a.concept_b, (validatedByConcept.get(a.concept_b) ?? 0) + 1)
  }

  for (const [cid, concept] of Object.entries(g.concepts)) {
    if (concept.status_fronteira !== 'expanded') continue
    const n = validatedByConcept.get(cid) ?? 0
    if (n === 0) {
      issues.push({
        kind: 'expanded-concept-dead-end',
        detail: `${cid}: marked expanded but has 0 validated associates (TOP_N=${TOP_N})`,
      })
    }
  }

  return { ok: issues.length === 0, issues, warnings: structure.warnings }
}
