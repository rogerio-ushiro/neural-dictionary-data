import { buildGraphIndex, topNAssociates, type GraphIndex } from '../model/v04/adjacency'
import { strengthToRadius } from '../model/v04/config'
import type { PublishedGraph } from '../model/v04/types'

export interface EgoNode {
  id: string
  label: string
  x: number
  y: number
  kind: 'center' | 'assoc'
  relationType?: string
  associationStrength?: number
}

export interface EgoEdge {
  id: string
  source: string
  target: string
  relationType: string
  associationStrength: number
}

export interface EgoView {
  nodes: EgoNode[]
  edges: EgoEdge[]
}

/**
 * The visible graph for one focused concept: the concept at the origin, its
 * TOP_N shown associates on concentric rings by `association_strength`
 * (continuous — D3, no discrete faixa). Pure — GraphView maps kind/strength to
 * theme-aware colours and sizes when it feeds sigma.
 *
 * `index` defaults to a fresh build (fine for tests/one-offs); the app builds
 * it once per `data` (App.tsx) and passes it in — a concept-without-sense
 * (spec-legal, validateStructure only warns on it) falls back to showing its
 * raw id as a label instead of crashing, matching GraphAssociatesList's
 * fallback. Only a truly unknown concept id (absent from `graph.concepts`)
 * throws — that is a caller bug, not a data-shape the model tolerates.
 */
export function egoView(graph: PublishedGraph, centerId: string, index: GraphIndex = buildGraphIndex(graph)): EgoView {
  if (!(centerId in graph.concepts)) throw new Error(`unknown concept id: ${centerId}`)
  const centerLabel = index.words.get(centerId) ?? centerId

  const shown = topNAssociates(centerId, index.adjacency, index.words)

  const nodes: EgoNode[] = [{ id: centerId, label: centerLabel, x: 0, y: 0, kind: 'center' }]
  const edges: EgoEdge[] = []

  // `shown` is already ordered by strength desc, then relation_type, then
  // lemma. Spread every associate evenly around the full circle and set the
  // radius by strength — so the ring stepping still reads, but the layout
  // stays symmetric about the centre for any count (the camera can then frame
  // it the same way).
  const n = shown.length
  shown.forEach((a, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2
    const r = strengthToRadius(a.association_strength)
    nodes.push({
      id: a.target,
      label: index.words.get(a.target) ?? a.target,
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r,
      kind: 'assoc',
      relationType: a.relation_type,
      associationStrength: a.association_strength,
    })
    edges.push({
      id: `e:${centerId}:${a.target}`,
      source: centerId,
      target: a.target,
      relationType: a.relation_type,
      associationStrength: a.association_strength,
    })
  })

  // Recentre on the bounding-box centre so the camera frames every ego view the
  // same way, however sparse the ring is.
  const xs = nodes.map((p) => p.x)
  const ys = nodes.map((p) => p.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  for (const p of nodes) {
    p.x -= cx
    p.y -= cy
  }

  return { nodes, edges }
}
