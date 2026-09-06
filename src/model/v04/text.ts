// Shared text normalisation for the v0.4 lexical layer. Used by the migration
// (Story 2) and by search (Story 3) — kept in one place so both fold the same
// way. Equivalent to v0.3's `foldForSearch` in adjacency.ts.

/** Accent- and case-insensitive key for prefix matching, e.g. `città` → `citta`. */
export function normalizeForm(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}
