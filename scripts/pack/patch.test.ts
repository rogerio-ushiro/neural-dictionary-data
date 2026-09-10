import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyShardPatch } from '../../src/data/loader'
import type { PublishedGraph } from '../../src/model/v04/types'
import type { GraphShard, Patch, PatchOp } from '../../src/model/v04/wire'
import { editAssociations } from '../routine/edit-associations'
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

describe('edit-associations round-trip (Story G)', () => {
  let seedPath: string
  let packsDir: string

  beforeEach(() => {
    seedPath = path.join(tmpDir, 'seed.json')
    packsDir = path.join(tmpDir, 'packs')
  })

  /** Write `graph` as the seed and build the packs it starts from — the "old"
   * state editAssociations snapshots and diffs against. */
  function seedAndPack(graph: PublishedGraph): void {
    fs.writeFileSync(seedPath, JSON.stringify(graph))
    buildPacks(seedPath, packsDir)
    writeManifest(packsDir)
  }

  /** Every op editAssociations wrote under packs/patches/. */
  function writtenOps(): PatchOp[] {
    const dir = path.join(packsDir, 'patches')
    if (!fs.existsSync(dir)) return []
    const ops: PatchOp[] = []
    for (const packDir of fs.readdirSync(dir)) {
      for (const file of fs.readdirSync(path.join(dir, packDir))) {
        const patch = JSON.parse(fs.readFileSync(path.join(dir, packDir, file), 'utf8')) as Patch
        ops.push(...patch.ops)
      }
    }
    return ops
  }

  const findAssoc = (g: PublishedGraph, a: string, b: string, t: string) =>
    g.associations.find((x) => x.concept_a === a && x.concept_b === b && x.relation_type === t)

  it('reweight → one UPDATE_ASSOCIATION, strength + revision bumped, status kept', async () => {
    seedAndPack(graphOf(30))
    await editAssociations(
      [{ concept_a: 'c_0001', concept_b: 'c_0002', relation_type: 'associata', op: 'reweight', to_strength: 0.9 }],
      { seedPath, packsDir },
    )

    // A cross-shard edge is mirrored into both shards' bundles, so the reweight
    // can surface as one UPDATE_ASSOCIATION per shard — all for the same key,
    // idempotent on the client. The contract is: it's an update, never a retype.
    const updates = writtenOps().filter((o) => o.op === 'UPDATE_ASSOCIATION')
    expect(updates.length).toBeGreaterThanOrEqual(1)
    for (const o of updates) {
      expect(o).toMatchObject({
        op: 'UPDATE_ASSOCIATION',
        association: { concept_a: 'c_0001', concept_b: 'c_0002', relation_type: 'associata', association_strength: 0.9, status: 'validated', revision: 2 },
      })
    }
    expect(writtenOps().some((o) => o.op === 'REMOVE_ASSOCIATION' || o.op === 'ADD_ASSOCIATION')).toBe(false)

    const final = dedupeShards(packsDir)
    expect(findAssoc(final, 'c_0001', 'c_0002', 'associata')).toMatchObject({ association_strength: 0.9, status: 'validated', revision: 2 })
  })

  it('retype → REMOVE (old key) + ADD (new key), no orphan, order-independent', async () => {
    seedAndPack(graphOf(30))
    await editAssociations(
      [{ concept_a: 'c_0002', concept_b: 'c_0003', relation_type: 'associata', op: 'retype', to_type: 'similarità' }],
      { seedPath, packsDir },
    )

    const ops = writtenOps()
    expect(
      ops.some((o) => o.op === 'REMOVE_ASSOCIATION' && o.concept_a === 'c_0002' && o.concept_b === 'c_0003' && o.relation_type === 'associata'),
    ).toBe(true)
    expect(
      ops.some((o) => o.op === 'ADD_ASSOCIATION' && o.association.concept_a === 'c_0002' && o.association.concept_b === 'c_0003' && o.association.relation_type === 'similarità' && o.association.revision === 2),
    ).toBe(true)

    const final = dedupeShards(packsDir)
    expect(findAssoc(final, 'c_0002', 'c_0003', 'similarità')).toBeDefined()
    expect(findAssoc(final, 'c_0002', 'c_0003', 'associata')).toBeUndefined()
  })

  it('deprecate → UPDATE_ASSOCIATION with status deprecated; client drops it from the ego view', async () => {
    seedAndPack(graphOf(30))
    await editAssociations(
      [{ concept_a: 'c_0004', concept_b: 'c_0005', relation_type: 'associata', op: 'deprecate' }],
      { seedPath, packsDir },
    )

    const updates = writtenOps().filter((o) => o.op === 'UPDATE_ASSOCIATION')
    expect(updates.some((o) => o.op === 'UPDATE_ASSOCIATION' && o.association.concept_a === 'c_0004' && o.association.status === 'deprecated' && o.association.revision === 2)).toBe(true)
  })

  it('retype into an existing (pair, type) aborts and leaves the seed untouched', async () => {
    const g = graphOf(30)
    g.associations.push({
      concept_a: 'c_0001', concept_b: 'c_0002', relation_type: 'similarità',
      direction_hint: 'symmetric', association_strength: 0.6, confidence: 1, status: 'validated', revision: 1,
    })
    seedAndPack(g)
    const before = fs.readFileSync(seedPath, 'utf8')

    await expect(
      editAssociations(
        [{ concept_a: 'c_0001', concept_b: 'c_0002', relation_type: 'associata', op: 'retype', to_type: 'similarità' }],
        { seedPath, packsDir },
      ),
    ).rejects.toThrow(/already exists/)
    expect(fs.readFileSync(seedPath, 'utf8')).toBe(before)
  })

  it('a candidate-status edge round-trips (Story D edits template edges on the routine branch)', async () => {
    const g = graphOf(30)
    findAssoc(g, 'c_0001', 'c_0002', 'associata')!.status = 'candidate'
    seedAndPack(g)

    await editAssociations(
      [{ concept_a: 'c_0001', concept_b: 'c_0002', relation_type: 'associata', op: 'reweight', to_strength: 0.8 }],
      { seedPath, packsDir },
    )

    const final = dedupeShards(packsDir)
    expect(findAssoc(final, 'c_0001', 'c_0002', 'associata')).toMatchObject({ status: 'candidate', association_strength: 0.8, revision: 2 })
  })

  it('matches the row regardless of concept_a/concept_b order in the edit', async () => {
    seedAndPack(graphOf(30))
    // c_0009 < c_0010 canonically; pass them reversed
    await editAssociations(
      [{ concept_a: 'c_0010', concept_b: 'c_0009', relation_type: 'associata', op: 'reweight', to_strength: 0.7 }],
      { seedPath, packsDir },
    )
    const final = dedupeShards(packsDir)
    expect(findAssoc(final, 'c_0009', 'c_0010', 'associata')).toMatchObject({ association_strength: 0.7 })
  })
})
