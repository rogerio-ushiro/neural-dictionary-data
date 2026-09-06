// Public surface of @neural-dictionary/client — everything the app imports.
// Re-exported per module (not cherry-picked) so a new symbol added to any of
// these is available to the app without touching this file.
//
// The app (neural-dictionary) imports ONLY from this barrel. The pipeline
// scripts in this repo import `src/**` directly via tsx and never go through
// the built package — see docs/projetos/neural-dictionary-data/CONTEXTO.md
// (Contrato de fronteira).

export * from './model/v04/types'
export * from './model/v04/config'
export * from './model/v04/adjacency'
export * from './model/v04/wire'
export * from './model/v04/text'
export * from './model/v04/validate'
export * from './model/v04/frontier'
export * from './graph/egoGraph'
export * from './search'
export * from './data/loader'
export * from './data/graphMerge'
