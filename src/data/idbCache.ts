// IndexedDB-backed pack cache (T4.4). Thin adapter behind the `CacheStore`
// interface — loader.ts is injected a store (default: this native
// implementation) so its logic can be tested without a real IndexedDB.

import type { SyncState } from '../model/v04/types'
import type { Manifest } from '../model/v04/wire'

export interface PackCacheEntry {
  id: string
  version: number
  hash: string
  content: unknown
}

export interface CacheStore {
  getManifest(): Promise<Manifest | null>
  setManifest(manifest: Manifest): Promise<void>
  getPack(id: string): Promise<PackCacheEntry | null>
  setPack(entry: PackCacheEntry): Promise<void>
  getSyncState(): Promise<SyncState | null>
  setSyncState(state: SyncState): Promise<void>
}

const DB_NAME = 'neural-dictionary'
const DB_VERSION = 1
const PACKS_STORE = 'packs'
const META_STORE = 'meta'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(PACKS_STORE)) db.createObjectStore(PACKS_STORE, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode)
    const request = fn(transaction.objectStore(store))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Opens (creating if needed) the browser's IndexedDB-backed pack cache. */
export async function openIdbCacheStore(): Promise<CacheStore> {
  const db = await openDb()
  return {
    async getManifest() {
      const v = await tx<Manifest | undefined>(db, META_STORE, 'readonly', (s) => s.get('manifest'))
      return v ?? null
    },
    async setManifest(manifest) {
      await tx(db, META_STORE, 'readwrite', (s) => s.put(manifest, 'manifest'))
    },
    async getPack(id) {
      const v = await tx<PackCacheEntry | undefined>(db, PACKS_STORE, 'readonly', (s) => s.get(id))
      return v ?? null
    },
    async setPack(entry) {
      await tx(db, PACKS_STORE, 'readwrite', (s) => s.put(entry))
    },
    async getSyncState() {
      const v = await tx<SyncState | undefined>(db, META_STORE, 'readonly', (s) => s.get('sync_state'))
      return v ?? null
    },
    async setSyncState(state) {
      await tx(db, META_STORE, 'readwrite', (s) => s.put(state, 'sync_state'))
    },
  }
}

/** In-memory store — for tests, or a same-tab "no persistence needed" mode. */
export function createMemoryCacheStore(): CacheStore {
  let manifest: Manifest | null = null
  let syncState: SyncState | null = null
  const packs = new Map<string, PackCacheEntry>()
  return {
    async getManifest() {
      return manifest
    },
    async setManifest(m) {
      manifest = m
    },
    async getPack(id) {
      return packs.get(id) ?? null
    },
    async setPack(entry) {
      packs.set(entry.id, entry)
    },
    async getSyncState() {
      return syncState
    },
    async setSyncState(s) {
      syncState = s
    },
  }
}
