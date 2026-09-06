// Builds the pack manifest (Story 4, T4.2, spec §42): one hash + version per
// pack, plus a global manifest_version. Idempotent — re-running over unchanged
// packs leaves versions untouched; only a changed pack's hash bumps its version.
//
// CLI: tsx scripts/pack/manifest.ts [--packs dir]
// Programmatic: writeManifest(packsDir)

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule, parseFlags } from '../lib/cli'
import type { Manifest, ManifestPackEntry } from '../../src/model/v04/wire'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function sha256(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

/** pack id, spec §42 style: `graph.<bucket>`, `lexicon.it.<prefix>`, `global`. */
function listPackFiles(packsDir: string): { id: string; filePath: string }[] {
  const out: { id: string; filePath: string }[] = []

  const graphDir = path.join(packsDir, 'graph')
  if (fs.existsSync(graphDir)) {
    for (const f of fs.readdirSync(graphDir).filter((f) => f.endsWith('.json')).sort()) {
      out.push({ id: `graph.${f.replace(/\.json$/, '')}`, filePath: path.join(graphDir, f) })
    }
  }

  const lexiconDir = path.join(packsDir, 'lexicon', 'it')
  if (fs.existsSync(lexiconDir)) {
    for (const f of fs.readdirSync(lexiconDir).filter((f) => f.endsWith('.json')).sort()) {
      out.push({ id: `lexicon.it.${f.replace(/\.json$/, '')}`, filePath: path.join(lexiconDir, f) })
    }
  }

  const globalPath = path.join(packsDir, 'global.json')
  if (fs.existsSync(globalPath)) out.push({ id: 'global', filePath: globalPath })

  return out
}

function readExistingManifest(packsDir: string): Manifest | null {
  const p = path.join(packsDir, 'manifest.json')
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Manifest
  } catch {
    return null
  }
}

export function computeManifest(packsDir: string, previous: Manifest | null): Manifest {
  const files = listPackFiles(packsDir)
  const prevById = new Map((previous?.packs ?? []).map((p) => [p.id, p]))

  const packs: ManifestPackEntry[] = files.map(({ id, filePath }) => {
    const hash = sha256(filePath)
    const prev = prevById.get(id)
    const version = prev && prev.hash === hash ? prev.version : (prev?.version ?? 0) + 1
    return { id, version, hash }
  })

  const changed =
    !previous ||
    packs.length !== previous.packs.length ||
    packs.some((p, i) => p.id !== previous.packs[i]?.id || p.hash !== previous.packs[i]?.hash)

  const manifest_version = changed ? (previous?.manifest_version ?? 0) + 1 : (previous?.manifest_version ?? 1)

  return { manifest_version, packs }
}

export function writeManifest(packsDir: string): Manifest {
  const manifest = computeManifest(packsDir, readExistingManifest(packsDir))
  fs.writeFileSync(path.join(packsDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

async function main(): Promise<void> {
  const { packs: packsArg } = parseFlags(process.argv.slice(2), ['packs'] as const)
  const packsDir = packsArg ? path.resolve(packsArg) : path.join(HERE, '../../public/data')
  const manifest = writeManifest(packsDir)
  process.stdout.write(`OK — manifest_version=${manifest.manifest_version}, ${manifest.packs.length} packs\n`)
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${(err as Error).stack ?? err}\n`)
    process.exit(1)
  })
}
