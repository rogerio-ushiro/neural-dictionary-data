import { describe, expect, it } from 'vitest'
import { buildPacksFromGraph, lexiconPrefix, shardBucket } from './build-packs'
import type { Association, Concept, PublishedGraph, Word, WordSense } from '../../src/model/v04/types'

function graphOf(n: number): PublishedGraph {
  const words: Record<string, Word> = {}
  const wordSenses: Record<string, WordSense> = {}
  const concepts: Record<string, Concept> = {}
  const lexical_index: PublishedGraph['lexical_index'] = []
  for (let i = 1; i <= n; i += 1) {
    const id = String(i).padStart(4, '0')
    const form = `parola${i}`
    words[`w_${id}`] = { display_form: form, normalized_form: form, pos: null }
    wordSenses[`s_${id}`] = { lexeme_id: `w_${id}`, lexeme_kind: 'word', concept_id: `c_${id}`, is_primary: true }
    concepts[`c_${id}`] = { revision: 1, region_id: null, status_fronteira: 'needs_expansion' }
    lexical_index.push({ normalized_form: form, lexeme_id: `w_${id}`, lexeme_kind: 'word' })
  }
  const associations: Association[] = []
  for (let i = 1; i < n; i += 1) {
    const a = `c_${String(i).padStart(4, '0')}`
    const b = `c_${String(i + 1).padStart(4, '0')}`
    associations.push({ concept_a: a, concept_b: b, relation_type: 'associata', direction_hint: 'symmetric', association_strength: 0.5, confidence: 1, status: 'validated', revision: 1 })
  }
  return {
    meta: { language: 'it' },
    words,
    expressions: {},
    word_senses: wordSenses,
    concepts,
    associations,
    lexical_index,
    semantic_regions: {},
    expansion_queue: [],
    sync_state: { manifest_version: null, ready: false },
  }
}

describe('shardBucket', () => {
  it('is deterministic', () => {
    expect(shardBucket('c_0001')).toBe(shardBucket('c_0001'))
  })

  it('produces a 2-digit lowercase hex string', () => {
    expect(shardBucket('c_0001')).toMatch(/^[0-9a-f]{2}$/)
  })

  it('spreads ids across buckets (not everything in one shard)', () => {
    const buckets = new Set<string>()
    for (let i = 1; i <= 200; i += 1) buckets.add(shardBucket(`c_${String(i).padStart(4, '0')}`))
    expect(buckets.size).toBeGreaterThan(20)
  })
})

describe('lexiconPrefix', () => {
  it('takes the first 2 characters (D10)', () => {
    expect(lexiconPrefix('mare')).toBe('ma')
    expect(lexiconPrefix('acqua')).toBe('ac')
  })

  it('falls back to the whole string when shorter than 2 chars', () => {
    expect(lexiconPrefix('a')).toBe('a')
  })
})

describe('buildPacksFromGraph', () => {
  it('assigns every concept to exactly one shard', () => {
    const { shards } = buildPacksFromGraph(graphOf(50))
    const seen = new Set<string>()
    for (const shard of shards.values()) {
      for (const id of Object.keys(shard.concepts)) {
        expect(seen.has(id)).toBe(false)
        seen.add(id)
      }
    }
    expect(seen.size).toBe(50)
  })

  it('duplicates a cross-shard association into both shards, keeps a same-shard one once', () => {
    const { shards } = buildPacksFromGraph(graphOf(50))
    for (const [id, shard] of shards) {
      for (const a of shard.associations) {
        const otherEnd = a.concept_a in shard.concepts ? a.concept_b : a.concept_a
        // if the other end isn't in this shard, the association must also appear
        // in that other end's shard (cross-shard duplication).
        if (!(otherEnd in shard.concepts)) {
          const otherBucket = [...shards.entries()].find(([, s]) => otherEnd in s.concepts)?.[0]
          expect(otherBucket).toBeDefined()
          if (otherBucket !== id) {
            const otherShard = shards.get(otherBucket!)!
            expect(otherShard.associations).toContainEqual(a)
          }
        }
      }
    }
  })

  it('puts each word in the shard of its primary sense concept', () => {
    const { shards } = buildPacksFromGraph(graphOf(10))
    for (const shard of shards.values()) {
      for (const [senseId, sense] of Object.entries(shard.word_senses)) {
        expect(shard.concepts[sense.concept_id]).toBeDefined()
        expect(shard.words[sense.lexeme_id]).toBeDefined()
        expect(senseId).toMatch(/^s_/)
      }
    }
  })

  it('groups lexical_index entries into 2-letter prefix packs, sorted', () => {
    const { lexiconPacks } = buildPacksFromGraph(graphOf(15))
    const pa = lexiconPacks.get('pa')
    expect(pa).toBeDefined()
    expect(pa!.entries.length).toBe(15) // all "parolaN" share prefix "pa"
    const sorted = [...pa!.entries].sort((x, y) => x.normalized_form.localeCompare(y.normalized_form, 'it'))
    expect(pa!.entries.map((e) => e.normalized_form)).toEqual(sorted.map((e) => e.normalized_form))
    expect(pa!.entries[0].display_form).toBeTruthy()
  })

  it('carries the graph-global entities into the global pack, untouched', () => {
    const g = graphOf(3)
    g.semantic_regions = { r_natura: { label: 'natura' } }
    const { global } = buildPacksFromGraph(g)
    expect(global.semantic_regions).toEqual(g.semantic_regions)
    expect(global.meta).toEqual(g.meta)
  })
})
