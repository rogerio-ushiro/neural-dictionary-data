// Separate file: mocks idbCache's openIdbCacheStore at module scope, so it
// can't leak into loader.test.ts's other cases (which use the real
// createMemoryCacheStore, unaffected by this mock since only one export is replaced).
import { describe, expect, it, vi } from 'vitest'

vi.mock('./idbCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./idbCache')>()
  return {
    ...actual,
    openIdbCacheStore: vi.fn(() => Promise.reject(new Error('IndexedDB unavailable (e.g. private browsing)'))),
  }
})

const { loadGraph } = await import('./loader')

describe('loadGraph — default store fallback', () => {
  it('falls back to an in-memory cache when the default openIdbCacheStore() itself fails to open', async () => {
    const manifest = { manifest_version: 1, packs: [{ id: 'global', version: 1, hash: 'g1' }] }
    const global1 = { meta: { language: 'it' as const }, semantic_regions: {}, expansion_queue: [], sync_state: { manifest_version: null, ready: false } }
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifest } as Response
      if (url.endsWith('global.json')) return { ok: true, json: async () => global1 } as Response
      return { ok: false, status: 404, statusText: 'not found' } as Response
    }) as unknown as typeof fetch

    // No `store` option passed — loadGraph must use its own fallback, not throw.
    const { status } = await loadGraph({ fetchImpl })
    expect(status).toBe('ready')
  })
})
