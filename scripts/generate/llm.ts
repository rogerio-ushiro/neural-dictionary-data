// Dormant API-backed AssociationSource (D15: not activated — `--source file`
// is the only active path). Kept compiling and up to date with the v0.4
// contract so it's ready if D15 is revisited, per T5.7.

import Anthropic from '@anthropic-ai/sdk'
import { MODEL, SYSTEM, buildUserPrompt } from './prompt'
import type { GenerationTask, RawCandidate } from './contract'

// Resolves ANTHROPIC_API_KEY (or an `ant auth login` profile) from the env.
const client = new Anthropic()

/** Tolerant parse: models sometimes wrap JSON in prose or ```json fences. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('no JSON object in response')
  return JSON.parse(body.slice(start, end + 1))
}

function isRawCandidate(entry: unknown): entry is RawCandidate {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as RawCandidate).lemma === 'string' &&
    typeof (entry as RawCandidate).relation_type === 'string' &&
    typeof (entry as RawCandidate).association_strength === 'number'
  )
}

export async function fetchCandidates(task: GenerationTask): Promise<RawCandidate[]> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 1536,
    system: SYSTEM,
    messages: [{ role: 'user', content: buildUserPrompt(task) }],
  })

  const textBlock = res.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error(`no text block returned for "${task.word}"`)
  }

  const parsed = extractJson(textBlock.text) as { candidates?: unknown }
  if (!Array.isArray(parsed.candidates)) {
    throw new Error(`"candidates" missing/!array for "${task.word}"`)
  }

  // `confidence` left as-is (possibly absent) — classify.ts is the single
  // place that applies DEFAULT_CANDIDATE_CONFIDENCE, for every source alike.
  return parsed.candidates.filter(isRawCandidate)
}
