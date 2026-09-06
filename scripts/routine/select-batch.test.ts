import { describe, expect, it } from 'vitest'
import { selectBatch } from './select-batch'
import type { PublishedGraph } from '../../src/model/v04/types'

function graphOf(n: number): PublishedGraph {
  const words: PublishedGraph['words'] = {}
  const wordSenses: PublishedGraph['word_senses'] = {}
  const concepts: PublishedGraph['concepts'] = {}
  for (let i = 1; i <= n; i += 1) {
    const id = String(i).padStart(4, '0')
    words[`w_${id}`] = { display_form: `parola${i}`, normalized_form: `parola${i}`, pos: null }
    wordSenses[`s_${id}`] = { lexeme_id: `w_${id}`, lexeme_kind: 'word', concept_id: `c_${id}`, is_primary: true }
    concepts[`c_${id}`] = { revision: 1, region_id: null, status_fronteira: 'needs_expansion' }
  }
  return {
    meta: { language: 'it' },
    words,
    expressions: {},
    word_senses: wordSenses,
    concepts,
    associations: [],
    lexical_index: [],
    semantic_regions: {},
    expansion_queue: [],
    sync_state: { manifest_version: null, ready: false },
  }
}

describe('selectBatch (routine)', () => {
  it('returns one GenerationTask per selected concept, capped at n', () => {
    const tasks = selectBatch(graphOf(20), 10)
    expect(tasks).toHaveLength(10)
    expect(tasks[0].word).toMatch(/^parola/)
  })

  it('defaults to the D13 batch size (10) when n is omitted', () => {
    const tasks = selectBatch(graphOf(20))
    expect(tasks).toHaveLength(10)
  })

  it('returns fewer than n tasks when the queue is smaller', () => {
    const tasks = selectBatch(graphOf(3), 10)
    expect(tasks).toHaveLength(3)
  })
})
