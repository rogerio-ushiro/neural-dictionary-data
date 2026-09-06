import { buildSearchIndex, type SearchEntry } from '../model/v04/adjacency'
import { normalizeForm } from '../model/v04/text'
import type { PublishedGraph } from '../model/v04/types'

export type { SearchEntry }

export const MAX_RESULTS = 10

interface IndexedEntry extends SearchEntry {
  /** Accent/case-folded lemma, precomputed for prefix matching. */
  folded: string
}

export interface SearchIndex {
  entries: IndexedEntry[]
}

export function createSearchIndex(graph: PublishedGraph): SearchIndex {
  return {
    entries: buildSearchIndex(graph).map((e) => ({ ...e, folded: normalizeForm(e.lemma) })),
  }
}

/**
 * Prefix match on the folded lemma. Because it is a prefix test, the result set
 * only shrinks as `query` grows — the "narrow as you type" behaviour. Results
 * are alphabetical (D6 — no relevance ranking in the MVP).
 */
export function search(index: SearchIndex, query: string, limit = MAX_RESULTS): SearchEntry[] {
  const q = normalizeForm(query.trim())
  if (!q) return []
  const out: SearchEntry[] = []
  for (const entry of index.entries) {
    if (entry.folded.startsWith(q)) {
      out.push({ id: entry.id, lemma: entry.lemma })
      if (out.length >= limit) break
    }
  }
  return out
}
