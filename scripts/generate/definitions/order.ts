// Backfill ordering for the definition generation (Epic word-definition-modal,
// T4.1, decision D3).
//
// The seed graph is hub-and-spoke: 3 connected components (989 / 17 / 15), most
// concepts are degree-1 leaves hanging off ~116 hubs. Two goals for the order in
// which concepts get defined:
//
//  - CONNECTED WALK — every concept (bar each component's root) appears *after*
//    at least one of its neighbours, so the sequence reads as one journey.
//  - THEMATIC SPREAD PER BATCH — a contiguous slice of ~50 should touch hubs,
//    mids and rim across the whole graph, never 50 words about one topic.
//
// Both hold via: BFS from each component's highest-degree node (parent always
// in an earlier layer → connectivity), and, inside every BFS layer, a
// round-robin across parent hubs (so a layer of leaves is interleaved by topic,
// not emitted hub-by-hub). Components are then merged by a fair emitted/total
// round-robin, so the two small islands are sprinkled through the whole run
// rather than tacked on at the end.
//
// Deterministic: every tie breaks on concept_id.

import type { PublishedGraph } from '../../../src/model/v04/types'

type Adjacency = Map<string, Set<string>>

function validatedAdjacency(graph: PublishedGraph): Adjacency {
  const adj: Adjacency = new Map()
  for (const id of Object.keys(graph.concepts)) adj.set(id, new Set())
  for (const a of graph.associations) {
    if (a.status !== 'validated') continue
    adj.get(a.concept_a)?.add(a.concept_b)
    adj.get(a.concept_b)?.add(a.concept_a)
  }
  return adj
}

function components(adj: Adjacency): string[][] {
  const seen = new Set<string>()
  const out: string[][] = []
  for (const start of [...adj.keys()].sort()) {
    if (seen.has(start)) continue
    const stack = [start]
    seen.add(start)
    const comp: string[] = []
    while (stack.length > 0) {
      const x = stack.pop() as string
      comp.push(x)
      for (const y of [...(adj.get(x) as Set<string>)].sort()) {
        if (!seen.has(y)) {
          seen.add(y)
          stack.push(y)
        }
      }
    }
    out.push(comp)
  }
  // Largest component first; ties broken by each component's smallest member id.
  const minId = (c: string[]) => c.reduce((m, x) => (x < m ? x : m))
  return out.sort((a, b) => b.length - a.length || minId(a).localeCompare(minId(b)))
}

/** Highest-degree node of `comp`; ties broken by concept_id. */
function rootOf(comp: string[], adj: Adjacency): string {
  return comp
    .slice()
    .sort((a, b) => (adj.get(b) as Set<string>).size - (adj.get(a) as Set<string>).size || a.localeCompare(b))[0]
}

/** One component, ordered: BFS layers from its root, each layer round-robined
 * across parent hubs. Guarantees parent-before-child. */
function orderComponent(comp: string[], adj: Adjacency): string[] {
  const root = rootOf(comp, adj)
  const depth = new Map<string, number>([[root, 0]])
  const parent = new Map<string, string | null>([[root, null]])
  const queue: string[] = [root]
  const layers: string[][] = [[root]]

  while (queue.length > 0) {
    const x = queue.shift() as string
    const d = depth.get(x) as number
    for (const y of [...(adj.get(x) as Set<string>)].sort()) {
      if (depth.has(y)) continue
      depth.set(y, d + 1)
      parent.set(y, x)
      queue.push(y)
      ;(layers[d + 1] ??= []).push(y)
    }
  }

  const degree = (id: string) => (adj.get(id) as Set<string>).size
  const ordered: string[] = []
  for (const layer of layers) {
    // group this layer's nodes by BFS parent
    const byParent = new Map<string, string[]>()
    for (const id of layer) {
      const p = parent.get(id) ?? id
      const group = byParent.get(p)
      if (group) group.push(id)
      else byParent.set(p, [id])
    }
    // parent groups strongest-hub first; members strongest first
    const groups = [...byParent.entries()]
      .sort((a, b) => degree(b[0]) - degree(a[0]) || a[0].localeCompare(b[0]))
      .map(([, ids]) => ids.sort((a, b) => degree(b) - degree(a) || a.localeCompare(b)))
    // round-robin across the groups
    for (let i = 0; groups.some((g) => i < g.length); i += 1) {
      for (const g of groups) if (i < g.length) ordered.push(g[i])
    }
  }
  return ordered
}

/**
 * Full backfill order — a permutation of every concept id in `graph`.
 * See the file header for the guarantees.
 */
export function buildBackfillOrder(graph: PublishedGraph): string[] {
  const adj = validatedAdjacency(graph)
  const perComp = components(adj).map((comp) => orderComponent(comp, adj))

  // Fair merge: repeatedly take the next node from whichever component has
  // emitted the smallest fraction of itself. Keeps small islands sprinkled
  // through the whole run instead of trailing at the end.
  const cursors = perComp.map(() => 0)
  const total = perComp.map((c) => c.length)
  const merged: string[] = []
  const grand = total.reduce((s, n) => s + n, 0)
  for (let step = 0; step < grand; step += 1) {
    let best = -1
    let bestRatio = Infinity
    for (let c = 0; c < perComp.length; c += 1) {
      if (cursors[c] >= total[c]) continue
      const ratio = cursors[c] / total[c]
      if (ratio < bestRatio - 1e-9) {
        bestRatio = ratio
        best = c
      }
    }
    merged.push(perComp[best][cursors[best]])
    cursors[best] += 1
  }
  return merged
}

/**
 * `n` concept ids evenly spaced along `order` — a stratified pilot sample that,
 * because `order` is already a diversified walk, spans hubs, mids, rim and both
 * small islands. Always includes `order[0]` (the top hub). `n >= order.length`
 * returns the whole order.
 */
export function pilotSample(order: string[], n: number): string[] {
  if (n >= order.length) return order.slice()
  if (n <= 0) return []
  const stride = order.length / n
  const out: string[] = []
  for (let i = 0; i < n; i += 1) out.push(order[Math.floor(i * stride)])
  return out
}
