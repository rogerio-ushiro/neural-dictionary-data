import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateStructure } from '../../src/model/v04/validate'
import type { PublishedGraph } from '../../src/model/v04/types'
import { buildPacks } from './build-packs'
import { dedupeShards } from './dedupe'
import { writeManifest } from './manifest'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndict-dedupe-'))
})
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

function graphOf(n: number): PublishedGraph {
  const words: PublishedGraph['words'] = {}
  const wordSenses: PublishedGraph['word_senses'] = {}
  const concepts: PublishedGraph['concepts'] = {}
  const lexical_index: PublishedGraph['lexical_index'] = []
  for (let i = 1; i <= n; i += 1) {
    const id = String(i).padStart(4, '0')
    const form = `parola${i}`
    words[`w_${id}`] = { display_form: form, normalized_form: form, pos: null }
    wordSenses[`s_${id}`] = { lexeme_id: `w_${id}`, lexeme_kind: 'word', concept_id: `c_${id}`, is_primary: true }
    concepts[`c_${id}`] = { revision: 1, region_id: null, status_fronteira: 'needs_expansion' }
    lexical_index.push({ normalized_form: form, lexeme_id: `w_${id}`, lexeme_kind: 'word' })
  }
  const associations: PublishedGraph['associations'] = []
  for (let i = 1; i < n; i += 1) {
    associations.push({
      concept_a: `c_${String(i).padStart(4, '0')}`,
      concept_b: `c_${String(i + 1).padStart(4, '0')}`,
      relation_type: 'associata',
      direction_hint: 'symmetric',
      association_strength: 0.5,
      confidence: 1,
      status: 'validated',
      revision: 1,
    })
  }
  return {
    meta: { language: 'it' },
    words,
    expressions: {},
    word_senses: wordSenses,
    concepts,
    associations,
    lexical_index,
    semantic_regions: { r_natura: { label: 'natura' } },
    expansion_queue: [],
    sync_state: { manifest_version: null, ready: false },
  }
}

describe('dedupeShards', () => {
  it('reconstructs a graph with no duplicate associations across shard boundaries', () => {
    const graph = graphOf(60) // enough concepts to spread across several of the 256 shards
    const srcPath = path.join(tmpDir, 'graph.json')
    fs.writeFileSync(srcPath, JSON.stringify(graph))
    const packsDir = path.join(tmpDir, 'packs')
    buildPacks(srcPath, packsDir)
    writeManifest(packsDir)

    const reconstructed = dedupeShards(packsDir)
    expect(reconstructed.associations).toHaveLength(graph.associations.length)
    expect(Object.keys(reconstructed.concepts)).toHaveLength(60)
  })

  it('produces a graph that passes validateStructure', () => {
    const graph = graphOf(60)
    const srcPath = path.join(tmpDir, 'graph.json')
    fs.writeFileSync(srcPath, JSON.stringify(graph))
    const packsDir = path.join(tmpDir, 'packs')
    buildPacks(srcPath, packsDir)
    writeManifest(packsDir)

    const res = validateStructure(dedupeShards(packsDir))
    expect(res.ok).toBe(true)
    expect(res.issues).toEqual([])
  })

  it('carries semantic_regions and lexical_index through the round trip', () => {
    const graph = graphOf(10)
    const srcPath = path.join(tmpDir, 'graph.json')
    fs.writeFileSync(srcPath, JSON.stringify(graph))
    const packsDir = path.join(tmpDir, 'packs')
    buildPacks(srcPath, packsDir)

    const reconstructed = dedupeShards(packsDir)
    expect(reconstructed.semantic_regions).toEqual(graph.semantic_regions)
    expect(reconstructed.lexical_index).toHaveLength(graph.lexical_index.length)
  })
})
