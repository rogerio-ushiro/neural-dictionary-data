// Shared entry-point boilerplate for the repo's tsx CLI scripts (migrate,
// metrics, pack/*). Extracted after the same ~15-line pattern showed up in 5
// scripts (Story 4 code review).

/** `--flag value` pairs; anything not in `allowed` throws (fail loud on typos). */
export function parseFlags<K extends string>(argv: string[], allowed: readonly K[]): Partial<Record<K, string>> {
  const allowedSet = new Set<string>(allowed)
  const args: Partial<Record<K, string>> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i]
    const flag = raw.startsWith('--') ? raw.slice(2) : ''
    if (!allowedSet.has(flag)) throw new Error(`unknown arg: ${raw}`)
    args[flag as K] = argv[(i += 1)]
  }
  return args
}

/** True when the current module was invoked directly (`tsx foo.ts`), not imported. */
export function isMainModule(importMetaUrl: string): boolean {
  return importMetaUrl === `file://${process.argv[1]}`
}
