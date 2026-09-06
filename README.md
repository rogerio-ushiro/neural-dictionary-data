# @neural-dictionary/client + data

The data layer of the [neural-dictionary](https://github.com/rogerio-ushiro/neural-dictionary)
app, split out so the app only imports an abstract client package and never
touches the data directly.

This repo owns:

- **The model** (`src/model/v04/`) — types, validation, adjacency/search indexes,
  wire formats. React-free.
- **The offline-first loader** (`src/data/`) — fetches packs, applies patches,
  caches in IndexedDB, never throws.
- **The graph view helper** (`src/graph/egoGraph.ts`) and **search** (`src/search/`).
- **The published packs** (`public/data/`) — 256 structural shards + lexicon +
  global + incremental patches, served from this repo's GitHub Pages.
- **The generation / growth pipeline** (`scripts/generate/`, `scripts/routine/`,
  `scripts/pack/`) and its content rules.

## The published package

`@neural-dictionary/client` (this repo's root `package.json`) exposes
`loadGraph`, `buildGraphIndex`, `egoView`, `search`, `validateStructure`, the
display helpers, and all types via `src/index.ts`. `loadGraph()` defaults to
fetching packs from this repo's Pages origin; pass `baseUrl` to override.

Consumed by the app via a git tag: `github:rogerio-ushiro/neural-dictionary-data#vX.Y.Z`.

## Scripts

- `npm run build` — Vite library build → `dist/` (also runs on install via `prepare`).
- `npm test` — vitest (model, pack, generate, routine, loader).
- `npm run lint` — oxlint.
- `npm run generate` — run the generation pipeline.
