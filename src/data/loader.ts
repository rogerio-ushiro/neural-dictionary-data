// Client loader: fetches the manifest + packs from the data host
// (`DATA_BASE_URL` — this repo's GitHub Pages, cross-origin; CORS `*`), diffs
// against the local cache (IndexedDB by default), fetches only what changed
// (a `graph.*` pack prefers its patch over a full re-fetch when one exists),
// reconstructs the PublishedGraph (graphMerge.ts), and reports `sync_state`.
// Pass `LoadOptions.baseUrl` to point elsewhere (dev, tests, a same-origin
// deployment).
//
// Depth policy (MVP): every pack in the manifest is fetched/cached on first
// load — no selective/on-demand shard fetching (spec §46/§47 deferred).
// `sync_state.ready` is true only once EVERY pack is present, fresh or cached.

import { mergeGraph } from './graphMerge'
import { createMemoryCacheStore, openIdbCacheStore, type CacheStore, type PackCacheEntry } from './idbCache'
import type { Association, PublishedGraph, SyncState } from '../model/v04/types'
import type { GlobalPack, GraphShard, LexiconPack, Manifest, ManifestPackEntry, Patch, PatchOp } from '../model/v04/wire'

const EMPTY_GLOBAL: GlobalPack = {
  meta: { language: 'it' },
  semantic_regions: {},
  expansion_queue: [],
  sync_state: { manifest_version: null, ready: false },
}

/**
 * Where the manifest and packs are served from. Default: this repo's GitHub
 * Pages `data/` directory (cross-origin; GitHub Pages sends
 * `Access-Control-Allow-Origin: *` so the response is readable and the loader
 * can populate IndexedDB). Kept as a single literal here and mirrored by the
 * Pages publish path in `.github/workflows/pages.yml`.
 */
export const DATA_BASE_URL = 'https://rogerio-ushiro.github.io/neural-dictionary-data/data'

export interface LoadOptions {
  /** Base the manifest/packs are served from. Default: `DATA_BASE_URL`.
   * Override for local dev, tests, or a same-origin deployment. */
  baseUrl?: string
  fetchImpl?: typeof fetch
  /** Default: IndexedDB. Inject `createMemoryCacheStore()` for tests, or a
   * same-tab in-memory mode where persistence across reloads isn't wanted. */
  store?: CacheStore
  onProgress?: (done: number, total: number) => void
}

export type SyncStatus = 'ready' | 'partial' | 'offline-cached' | 'empty'

export interface LoadResult {
  graph: PublishedGraph
  syncState: SyncState
  /** `ready` — every pack fresh/cached; `partial` — some packs missing after a
   * real attempt (e.g. one request failed); `offline-cached` — the manifest
   * fetch itself failed, serving entirely from a previous session's cache;
   * `empty` — no manifest at all (no cache, remote fetch failed) or a manifest
   * with zero pack content obtainable (first load, no network, nothing cached
   * yet) — `graph` is still a valid, empty PublishedGraph, never thrown. */
  status: SyncStatus
}

function packPath(id: string): string {
  if (id === 'global') return 'global.json'
  if (id.startsWith('graph.')) return `graph/${id.slice('graph.'.length)}.json`
  if (id.startsWith('lexicon.it.')) return `lexicon/it/${id.slice('lexicon.it.'.length)}.json`
  throw new Error(`unrecognised pack id: ${id}`)
}

function associationKey(a: Association | { concept_a: string; concept_b: string; relation_type: string }): string {
  return `${a.concept_a}|${a.concept_b}|${a.relation_type}`
}

/** Applies a graph-shard patch to a cached shard (client-side mirror of what
 * scripts/pack/patch.ts's ops encode — see its round-trip test). */
export function applyShardPatch(base: GraphShard, patch: Patch): GraphShard {
  const shard: GraphShard = {
    shard: base.shard,
    concepts: { ...base.concepts },
    associations: [...base.associations],
    word_senses: { ...base.word_senses },
    words: { ...base.words },
    expressions: { ...base.expressions },
  }
  const byKey = new Map(shard.associations.map((a) => [associationKey(a), a] as const))

  const apply = (op: PatchOp): void => {
    switch (op.op) {
      case 'ADD_CONCEPT':
      case 'UPDATE_CONCEPT':
        shard.concepts[op.concept_id] = op.concept
        break
      case 'ADD_ASSOCIATION':
      case 'UPDATE_ASSOCIATION':
        byKey.set(associationKey(op.association), op.association)
        break
      case 'REMOVE_ASSOCIATION':
        byKey.delete(associationKey(op))
        break
    }
  }
  for (const op of patch.ops) apply(op)
  shard.associations = [...byKey.values()]
  return shard
}

async function fetchJson<T>(fetchImpl: typeof fetch, url: string): Promise<T> {
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

function sortedById(packs: ManifestPackEntry[]): ManifestPackEntry[] {
  return [...packs].sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * Fetches one pack's fresh content — via its patch when the cache holds a
 * usable base and a patch file exists (bandwidth win for `graph.*` packs),
 * otherwise a full re-fetch. Only `graph.*` packs ever get a patch; a changed
 * `lexicon.*`/`global` pack is always fetched whole (patch.ts never emits one).
 *
 * Only ever tries a single-hop patch (`<cached.version>-<entry.version>.json`)
 * — a client that missed several publish cycles in a row (e.g. offline for a
 * while) won't find that exact file (the server only ever wrote consecutive
 * n-to-(n+1) patches) and transparently falls through to a full re-fetch.
 * This is correct, just not a bandwidth win for that client — not a bug.
 */
async function fetchPackContent(
  fetchImpl: typeof fetch,
  baseUrl: string,
  entry: ManifestPackEntry,
  cached: PackCacheEntry | null,
): Promise<unknown> {
  if (cached && entry.id.startsWith('graph.') && cached.version < entry.version) {
    try {
      const patch = await fetchJson<Patch>(fetchImpl, `${baseUrl}/patches/${entry.id}/${cached.version}-${entry.version}.json`)
      return applyShardPatch(cached.content as GraphShard, patch)
    } catch {
      // no patch published for this version jump (or it 404s) — fall through to a full fetch
    }
  }
  return fetchJson(fetchImpl, `${baseUrl}/${packPath(entry.id)}`)
}

function emptyResult(): LoadResult {
  const syncState: SyncState = { manifest_version: null, ready: false }
  return { graph: mergeGraph({ global: EMPTY_GLOBAL, shards: [], lexiconPacks: [] }), syncState, status: 'empty' }
}

/**
 * IndexedDB can throw/reject synchronously in some browsers/modes (Safari
 * private browsing, storage permission denied, quota exhausted) — that must
 * degrade to an in-memory cache for this load, not take down the whole app
 * when the network is perfectly fine.
 */
async function openStore(): Promise<CacheStore> {
  try {
    return await openIdbCacheStore()
  } catch {
    return createMemoryCacheStore()
  }
}

export async function loadGraph(opts: LoadOptions = {}): Promise<LoadResult> {
  const baseUrl = opts.baseUrl ?? DATA_BASE_URL
  const fetchImpl = opts.fetchImpl ?? fetch
  const store = opts.store ?? (await openStore())

  const cachedManifest = await store.getManifest()

  let remoteManifest: Manifest | null = null
  try {
    remoteManifest = await fetchJson<Manifest>(fetchImpl, `${baseUrl}/manifest.json`)
  } catch {
    remoteManifest = null // offline, or the server/host is unreachable
  }

  const manifest = remoteManifest ?? cachedManifest
  // Genuinely nothing to show — first-ever load with no network. Degrade to
  // an empty-but-valid graph (status 'empty') rather than throw: the app can
  // still render its "search a word" shell instead of a scary error screen.
  if (!manifest) return emptyResult()

  const packs = sortedById(manifest.packs)
  let done = 0
  const contentById = new Map<string, unknown>()

  await Promise.all(
    packs.map(async (entry) => {
      try {
        const cached = await store.getPack(entry.id)
        let content: unknown
        if (cached && cached.hash === entry.hash) {
          content = cached.content
        } else if (remoteManifest) {
          content = await fetchPackContent(fetchImpl, baseUrl, entry, cached)
          await store.setPack({ id: entry.id, version: entry.version, hash: entry.hash, content })
        } else if (cached) {
          content = cached.content // offline: best-effort, may be stale vs. `entry`
        } else {
          return // unavailable — neither fetchable nor cached; `complete` below reflects it
        }
        contentById.set(entry.id, content)
      } catch {
        // fetch/cache failure for this one pack — `complete` below reflects it
      } finally {
        done += 1
        opts.onProgress?.(done, packs.length)
      }
    }),
  )

  if (contentById.size === 0) return emptyResult()

  // The `global` pack is always in a real manifest (buildPacks always writes
  // one) — if it's still missing here, both the network AND the cache failed
  // for that one entry specifically. Degrade gracefully with an empty-but-
  // valid stand-in rather than discard whatever shards/lexicon DID come
  // through: `complete` below still correctly reflects the gap as 'partial'.
  const global = (contentById.get('global') as GlobalPack | undefined) ?? EMPTY_GLOBAL
  const shards = packs.filter((p) => p.id.startsWith('graph.')).flatMap((p) => (contentById.has(p.id) ? [contentById.get(p.id) as GraphShard] : []))
  const lexiconPacks = packs
    .filter((p) => p.id.startsWith('lexicon.'))
    .flatMap((p) => (contentById.has(p.id) ? [contentById.get(p.id) as LexiconPack] : []))

  const graph = mergeGraph({ global, shards, lexiconPacks })
  const complete = contentById.size === packs.length

  let status: SyncStatus
  if (!remoteManifest && cachedManifest) status = complete ? 'offline-cached' : 'partial'
  else status = complete ? 'ready' : 'partial'

  const syncState: SyncState = { manifest_version: manifest.manifest_version, ready: status === 'ready' || status === 'offline-cached' }
  await store.setManifest(manifest)
  await store.setSyncState(syncState)

  return { graph: { ...graph, sync_state: syncState }, syncState, status }
}

export { createMemoryCacheStore }
export type { CacheStore }
