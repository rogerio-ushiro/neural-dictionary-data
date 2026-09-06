import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyShardPatch } from '../../src/data/loader'
import type { PublishedGraph } from '../../src/model/v04/types'
import type { GraphShard } from '../../src/model/v04/wire'
import { buildPacks } from './build-packs'
import { dedupeShards } from './dedupe'
import { writeManifest } from './manifest'
import { diffManifest, diffShard, writePatch } from './patch'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ndict-patch-'))
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
    semantic_regions: {},
    expansion_queue: [],
    sync_state: { manifest_version: null, ready: false },
  }
}

function build(graph: PublishedGraph, packsDir: string): void {
  const srcPath = path.join(tmpDir, `src-${Math.random()}.json`)
  fs.writeFileSync(srcPath, JSON.stringify(graph))
  buildPacks(srcPath, packsDir)
  writeManifest(packsDir)
}

describe('diffManifest + writePatch', () => {
  it('produces no patches when nothing changed', () => {
    const oldDir = path.join(tmpDir, 'old')
    const newDir = path.join(tmpDir, 'new')
    build(graphOf(60), oldDir)
    build(graphOf(60), newDir)
    expect(diffManifest(oldDir, newDir)).toEqual([])
  })

  it('emits UPDATE_CONCEPT for a concept whose status_fronteira flipped', () => {
    const oldDir = path.join(tmpDir, 'old')
    const newDir = path.join(tmpDir, 'new')
    const base = graphOf(60)
    build(base, oldDir)
    const changed: PublishedGraph = { ...base, concepts: { ...base.concepts, c_0001: { revision: 2, region_id: null, status_fronteira: 'expanded' } } }
    build(changed, newDir)

    const patches = diffManifest(oldDir, newDir)
    expect(patches.length).toBeGreaterThan(0)
    const op = patches.flatMap((p) => p.ops).find((o) => o.op === 'UPDATE_CONCEPT' && o.concept_id === 'c_0001')
    expect(op).toBeDefined()
  })

  it('emits one UPDATE_CONCEPT when only `definition` changed (revision equal)', () => {
    const oldDir = path.join(tmpDir, 'old')
    const newDir = path.join(tmpDir, 'new')
    const base = graphOf(60)
    build(base, oldDir)
    const changed: PublishedGraph = {
      ...base,
      concepts: {
        ...base.concepts,
        c_0001: { revision: 1, region_id: null, status_fronteira: 'needs_expansion', definition: { text: 'Def.', example: 'Esempio.' } },
      },
    }
    build(changed, newDir)

    const ops = diffManifest(oldDir, newDir).flatMap((p) => p.ops)
    const conceptOps = ops.filter((o) => o.op === 'UPDATE_CONCEPT')
    expect(conceptOps).toHaveLength(1)
    expect(conceptOps[0]).toMatchObject({ concept_id: 'c_0001' })
    expect((conceptOps[0] as { concept: PublishedGraph['concepts'][string] }).concept.definition).toEqual({ text: 'Def.', example: 'Esempio.' })
  })

  it('emits no concept ops when `definition` is equal by value on both sides', () => {
    const oldDir = path.join(tmpDir, 'old')
    const newDir = path.join(tmpDir, 'new')
    const withDef = (): PublishedGraph => {
      const g = graphOf(60)
      g.concepts.c_0001.definition = { text: 'Def.', example: 'Esempio.' }
      return g
    }
    build(withDef(), oldDir)
    build(withDef(), newDir) // separate object, same values
    const ops = diffManifest(oldDir, newDir).flatMap((p) => p.ops)
    expect(ops.filter((o) => o.op === 'UPDATE_CONCEPT')).toHaveLength(0)
  })

  it('emits ADD_ASSOCIATION for a brand-new edge, none for unrelated shards', () => {
    const oldDir = path.join(tmpDir, 'old')
    const newDir = path.join(tmpDir, 'new')
    const base = graphOf(60)
    build(base, oldDir)
    const changed: PublishedGraph = { ...base, associations: [...base.associations, { concept_a: 'c_0001', concept_b: 'c_0060', relation_type: 'similarità', direction_hint: 'symmetric', association_strength: 0.6, confidence: 1, status: 'validated', revision: 1 }] }
    build(changed, newDir)

    const patches = diffManifest(oldDir, newDir)
    const adds = patches.flatMap((p) => p.ops).filter((o) => o.op === 'ADD_ASSOCIATION')
    expect(adds.length).toBeGreaterThanOrEqual(1)
    expect(adds.some((o) => o.op === 'ADD_ASSOCIATION' && o.association.relation_type === 'similarità')).toBe(true)
  })

  it('applying the reconstructed old+patches yields the same graph as the new dedupe (round trip)', () => {
    const oldDir = path.join(tmpDir, 'old')
    const newDir = path.join(tmpDir, 'new')
    const base = graphOf(30)
    build(base, oldDir)
    const changed: PublishedGraph = {
      ...base,
      concepts: { ...base.concepts, c_0002: { revision: 2, region_id: null, status_fronteira: 'expanded' } },
      associations: [...base.associations, { concept_a: 'c_0001', concept_b: 'c_0030', relation_type: 'similarità', direction_hint: 'symmetric', association_strength: 0.6, confidence: 1, status: 'validated', revision: 1 }],
    }
    build(changed, newDir)

    const patches = diffManifest(oldDir, newDir)
    writePatch(patches, newDir)

    // apply every op onto a copy of the old reconstructed graph
    const applied = dedupeShards(oldDir)
    for (const patch of patches) {
      for (const op of patch.ops) {
        if (op.op === 'ADD_CONCEPT' || op.op === 'UPDATE_CONCEPT') applied.concepts[op.concept_id] = op.concept
        else if (op.op === 'ADD_ASSOCIATION' || op.op === 'UPDATE_ASSOCIATION') {
          applied.associations = applied.associations.filter((a) => !(a.concept_a === op.association.concept_a && a.concept_b === op.association.concept_b && a.relation_type === op.association.relation_type))
          applied.associations.push(op.association)
        } else if (op.op === 'REMOVE_ASSOCIATION') {
          applied.associations = applied.associations.filter((a) => !(a.concept_a === op.concept_a && a.concept_b === op.concept_b && a.relation_type === op.relation_type))
        }
      }
    }

    const target = dedupeShards(newDir)
    expect(applied.concepts).toEqual(target.concepts)
    expect(applied.associations.length).toBe(target.associations.length)

    const patchFile = path.join(newDir, 'patches', patches[0].pack, `${patches[0].from}-${patches[0].to}.json`)
    expect(fs.existsSync(patchFile)).toBe(true)
  })

  it('a shard patched by the client-side applyShardPatch (src/data/loader.ts) matches diffShard\'s own target exactly', () => {
    // Cross-boundary regression: the server (diffShard, this file) and the
    // client (applyShardPatch, src/data/loader.ts) must agree on what a patch
    // means. Any drift between the two implementations would ship silently —
    // Story 7 is the first time a real patch flows through this path in prod.
    const oldShard: GraphShard = {
      shard: '00',
      concepts: { c_0001: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' } },
      associations: [{ concept_a: 'c_0001', concept_b: 'c_0002', relation_type: 'associata', association_strength: 0.5, confidence: 1, status: 'validated', revision: 1 }],
      word_senses: {},
      words: {},
      expressions: {},
    }
    const newShard: GraphShard = {
      ...oldShard,
      concepts: { c_0001: { revision: 2, region_id: 'r_natura', status_fronteira: 'expanded' }, c_0003: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' } },
      associations: [
        { concept_a: 'c_0001', concept_b: 'c_0003', relation_type: 'costituzione', association_strength: 0.7, confidence: 1, status: 'validated', revision: 1 },
      ],
    }

    const ops = diffShard(oldShard, newShard)
    const patched = applyShardPatch(oldShard, { pack: 'graph.00', from: 1, to: 2, ops })

    expect(patched.concepts).toEqual(newShard.concepts)
    expect([...patched.associations].sort((a, b) => a.relation_type.localeCompare(b.relation_type))).toEqual(
      [...newShard.associations].sort((a, b) => a.relation_type.localeCompare(b.relation_type)),
    )
  })
})
