import { describe, expect, it, vi } from 'vitest'
import { applyShardPatch, loadGraph } from './loader'
import { createMemoryCacheStore } from './idbCache'
import type { GraphShard, Manifest } from '../model/v04/wire'

const emptyShard = (id: string): GraphShard => ({ shard: id, concepts: {}, associations: [], word_senses: {}, words: {}, expressions: {} })

const manifestV1: Manifest = {
  manifest_version: 1,
  packs: [
    { id: 'global', version: 1, hash: 'g1' },
    { id: 'graph.00', version: 1, hash: 's1' },
    { id: 'lexicon.it.ma', version: 1, hash: 'l1' },
  ],
}

const global1 = { meta: { language: 'it' as const }, semantic_regions: {}, expansion_queue: [], sync_state: { manifest_version: null, ready: false } }
const shard1: GraphShard = {
  ...emptyShard('00'),
  concepts: { c_0001: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' } },
  words: { w_0001: { display_form: 'mare', normalized_form: 'mare', pos: null } },
  word_senses: { s_0001: { lexeme_id: 'w_0001', lexeme_kind: 'word', concept_id: 'c_0001', is_primary: true } },
}
const lexicon1 = { prefix: 'ma', entries: [{ normalized_form: 'mare', lexeme_id: 'w_0001', lexeme_kind: 'word' as const, display_form: 'mare' }] }

function fakeFetch(routes: Record<string, unknown | (() => unknown)>, opts: { fail?: string[] } = {}): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const path = url.replace(/^.*\/data\//, '')
    if (opts.fail?.includes(path)) return { ok: false, status: 500, statusText: 'boom' } as Response
    const entry = Object.entries(routes).find(([k]) => url.endsWith(k))
    if (!entry) return { ok: false, status: 404, statusText: 'not found' } as Response
    const value = typeof entry[1] === 'function' ? (entry[1] as () => unknown)() : entry[1]
    return { ok: true, json: async () => value } as Response
  }) as unknown as typeof fetch
}

describe('loadGraph', () => {
  it('fetches every pack on a cold cache and assembles a valid graph, status ready', async () => {
    const fetchImpl = fakeFetch({ 'manifest.json': manifestV1, 'global.json': global1, 'graph/00.json': shard1, 'lexicon/it/ma.json': lexicon1 })
    const { graph, status } = await loadGraph({ store: createMemoryCacheStore(), fetchImpl })
    expect(status).toBe('ready')
    expect(graph.words.w_0001.display_form).toBe('mare')
    expect(graph.concepts.c_0001).toBeDefined()
    expect(graph.lexical_index).toHaveLength(1)
  })

  it('reuses cached packs whose hash matches the manifest, without re-fetching them', async () => {
    const store = createMemoryCacheStore()
    await store.setPack({ id: 'global', version: 1, hash: 'g1', content: global1 })
    await store.setPack({ id: 'graph.00', version: 1, hash: 's1', content: shard1 })
    await store.setPack({ id: 'lexicon.it.ma', version: 1, hash: 'l1', content: lexicon1 })

    const fetchImpl = fakeFetch({ 'manifest.json': manifestV1 })
    const { status } = await loadGraph({ store, fetchImpl })
    expect(status).toBe('ready')
    // only the manifest should have been fetched — every pack hash matched the cache
    expect((fetchImpl as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
  })

  it('falls back to the cache entirely when the manifest fetch fails (offline)', async () => {
    const store = createMemoryCacheStore()
    await store.setManifest(manifestV1)
    await store.setPack({ id: 'global', version: 1, hash: 'g1', content: global1 })
    await store.setPack({ id: 'graph.00', version: 1, hash: 's1', content: shard1 })
    await store.setPack({ id: 'lexicon.it.ma', version: 1, hash: 'l1', content: lexicon1 })

    const offlineFetch = vi.fn(async () => ({ ok: false, status: 0, statusText: 'offline' }) as Response) as unknown as typeof fetch
    const { status, graph } = await loadGraph({ store, fetchImpl: offlineFetch })
    expect(status).toBe('offline-cached')
    expect(graph.concepts.c_0001).toBeDefined()
  })

  it('reports status "partial" when some (but not all) packs are unavailable', async () => {
    const fetchImpl = fakeFetch(
      { 'manifest.json': manifestV1, 'global.json': global1, 'graph/00.json': shard1, 'lexicon/it/ma.json': lexicon1 },
      { fail: ['lexicon/it/ma.json'] },
    )
    const { status } = await loadGraph({ store: createMemoryCacheStore(), fetchImpl })
    expect(status).toBe('partial')
  })

  it('degrades to an empty-but-valid graph (status "empty") when there is nothing cached and the manifest fetch fails — never throws', async () => {
    const offlineFetch = vi.fn(async () => ({ ok: false, status: 0, statusText: 'offline' }) as Response) as unknown as typeof fetch
    const { status, graph, syncState } = await loadGraph({ store: createMemoryCacheStore(), fetchImpl: offlineFetch })
    expect(status).toBe('empty')
    expect(graph.concepts).toEqual({})
    expect(syncState.ready).toBe(false)
  })

  it('degrades to "empty" when the manifest is fetched but every pack fetch fails (nothing cached either)', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifestV1 } as Response
      return { ok: false, status: 500, statusText: 'boom' } as Response
    }) as unknown as typeof fetch
    const { status, graph } = await loadGraph({ store: createMemoryCacheStore(), fetchImpl })
    expect(status).toBe('empty')
    expect(graph.concepts).toEqual({})
  })

  it('uses the patch route (not a full re-fetch) for a graph.* pack whose version advanced by one', async () => {
    const store = createMemoryCacheStore()
    await store.setPack({ id: 'graph.00', version: 1, hash: 's1', content: shard1 })
    await store.setPack({ id: 'global', version: 1, hash: 'g1', content: global1 })
    await store.setPack({ id: 'lexicon.it.ma', version: 1, hash: 'l1', content: lexicon1 })

    const manifestV2: Manifest = { manifest_version: 2, packs: [{ id: 'global', version: 1, hash: 'g1' }, { id: 'graph.00', version: 2, hash: 's2' }, { id: 'lexicon.it.ma', version: 1, hash: 'l1' }] }
    const patch = { pack: 'graph.00', from: 1, to: 2, ops: [{ op: 'ADD_CONCEPT' as const, concept_id: 'c_0002', concept: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' as const } }] }

    let patchFetched = false
    let fullShardFetched = false
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifestV2 } as Response
      if (url.includes('/patches/graph.00/1-2.json')) {
        patchFetched = true
        return { ok: true, json: async () => patch } as Response
      }
      if (url.endsWith('graph/00.json')) {
        fullShardFetched = true
        return { ok: true, json: async () => shard1 } as Response
      }
      return { ok: false, status: 404, statusText: 'not found' } as Response
    }) as unknown as typeof fetch

    const { graph } = await loadGraph({ store, fetchImpl })
    expect(patchFetched).toBe(true)
    expect(fullShardFetched).toBe(false)
    expect(graph.concepts.c_0002).toBeDefined() // came from the patch, not a fresh full shard
    expect(graph.concepts.c_0001).toBeDefined() // preserved from the cached base
  })

  it('falls back to a full re-fetch when the single-hop patch file is missing (multi-version gap)', async () => {
    const store = createMemoryCacheStore()
    await store.setPack({ id: 'graph.00', version: 1, hash: 's1', content: shard1 })
    await store.setPack({ id: 'global', version: 1, hash: 'g1', content: global1 })
    await store.setPack({ id: 'lexicon.it.ma', version: 1, hash: 'l1', content: lexicon1 })

    const shard1v3: GraphShard = { ...shard1, concepts: { ...shard1.concepts, c_0099: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' } } }
    const manifestV3: Manifest = { manifest_version: 3, packs: [{ id: 'global', version: 1, hash: 'g1' }, { id: 'graph.00', version: 3, hash: 's3' }, { id: 'lexicon.it.ma', version: 1, hash: 'l1' }] }

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifestV3 } as Response
      if (url.includes('/patches/')) return { ok: false, status: 404, statusText: 'not found' } as Response // no 1-3 patch published
      if (url.endsWith('graph/00.json')) return { ok: true, json: async () => shard1v3 } as Response
      return { ok: false, status: 404, statusText: 'not found' } as Response
    }) as unknown as typeof fetch

    const { graph, status } = await loadGraph({ store, fetchImpl })
    expect(status).toBe('ready')
    expect(graph.concepts.c_0099).toBeDefined()
  })

  it('propagates a failure from an explicitly injected store (no silent fallback for a caller-provided store)', async () => {
    const brokenStore = {
      getManifest: () => Promise.reject(new Error('IDB unavailable')),
      setManifest: () => Promise.resolve(),
      getPack: () => Promise.reject(new Error('IDB unavailable')),
      setPack: () => Promise.resolve(),
      getSyncState: () => Promise.resolve(null),
      setSyncState: () => Promise.resolve(),
    }
    const fetchImpl = fakeFetch({ 'manifest.json': manifestV1, 'global.json': global1, 'graph/00.json': shard1, 'lexicon/it/ma.json': lexicon1 })
    await expect(loadGraph({ store: brokenStore, fetchImpl })).rejects.toThrow('IDB unavailable')
  })

  it('persists the manifest and sync_state to the store after a load', async () => {
    const store = createMemoryCacheStore()
    const fetchImpl = fakeFetch({ 'manifest.json': manifestV1, 'global.json': global1, 'graph/00.json': shard1, 'lexicon/it/ma.json': lexicon1 })
    await loadGraph({ store, fetchImpl })
    expect(await store.getManifest()).toEqual(manifestV1)
    expect((await store.getSyncState())?.ready).toBe(true)
  })
})

describe('applyShardPatch', () => {
  it('applies ADD_CONCEPT / ADD_ASSOCIATION / REMOVE_ASSOCIATION', () => {
    const base: GraphShard = {
      ...emptyShard('00'),
      concepts: { c_0001: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' } },
      associations: [{ concept_a: 'c_0001', concept_b: 'c_0002', relation_type: 'associata', association_strength: 0.5, confidence: 1, status: 'validated', revision: 1 }],
    }
    const patched = applyShardPatch(base, {
      pack: 'graph.00',
      from: 1,
      to: 2,
      ops: [
        { op: 'ADD_CONCEPT', concept_id: 'c_0003', concept: { revision: 1, region_id: null, status_fronteira: 'needs_expansion' } },
        { op: 'REMOVE_ASSOCIATION', concept_a: 'c_0001', concept_b: 'c_0002', relation_type: 'associata' },
      ],
    })
    expect(patched.concepts.c_0003).toBeDefined()
    expect(patched.associations).toHaveLength(0)
    expect(base.associations).toHaveLength(1) // base untouched
  })
})
