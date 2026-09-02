import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import distance from '@turf/distance'
import { point } from '@turf/helpers'
import type { Position, TrimmedLine } from './match'
import type { OsmNode, OsmResponse, OsmWay } from './overpass'
import type { ScopeConfig } from '../gtfs/read'

export function buildRailQuery(scope: ScopeConfig): string {
    const { minLat, minLon, maxLat, maxLon } = scope.bbox
    const bbox = `${minLat},${minLon},${maxLat},${maxLon}`
    return [
        '[out:json][timeout:300];',
        `way["railway"~"^(rail|light_rail|narrow_gauge)$"](${bbox});`,
        'out body;',
        '>;',
        'out skel qt;',
    ].join('\n')
}

/**
 * Returns every railway way (and its nodes) in the bbox, from the committed cache
 * when present. Mirrors `fetchRoutes` in overpass.ts: a cache miss is the exception,
 * and `refresh` must be asked for explicitly.
 */
export async function fetchRailways(
    scope: ScopeConfig,
    opts: { refresh?: boolean; cacheDir?: string; fetchFn?: typeof fetch } = {},
): Promise<OsmResponse> {
    const cacheDir = opts.cacheDir ?? 'data/cache/osm'
    const cachePath = join(cacheDir, 'railways.json')
    const fetchFn = opts.fetchFn ?? fetch

    if (!opts.refresh && existsSync(cachePath)) {
        return JSON.parse(readFileSync(cachePath, 'utf8')) as OsmResponse
    }

    const res = await fetchFn(scope.overpassUrl, {
        method: 'POST',
        // overpass-api.de rejects requests with no User-Agent header with 406, the same
        // lesson overpass.ts already learned for the route-relation query.
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Breclav-MHD-Mapa/1.0 (+https://github.com/MrCoft/Breclav-MHD-Mapa)',
        },
        body: new URLSearchParams({ data: buildRailQuery(scope) }),
    })
    if (!res.ok) {
        throw new Error(`Overpass failed: ${res.status} ${res.statusText}`)
    }

    const body = (await res.json()) as OsmResponse
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(cachePath, `${JSON.stringify(body)}\n`, 'utf8')
    return body
}

export interface RailGraphEdge {
    to: number
    weight: number
}

export interface RailGraph {
    /** OSM node id -> [lon, lat]. */
    nodes: Map<number, Position>
    /** OSM node id -> its edges. Undirected: every edge appears on both endpoints. */
    adjacency: Map<number, RailGraphEdge[]>
}

/** Every way contributes edges between consecutive nodes, weighted by great-circle distance. */
export function buildRailGraph(ways: OsmWay[], nodes: OsmNode[]): RailGraph {
    const nodePositions = new Map<number, Position>()
    for (const n of nodes) {
        nodePositions.set(n.id, [n.lon, n.lat])
    }

    const adjacency = new Map<number, RailGraphEdge[]>()
    const addEdge = (a: number, b: number): void => {
        const posA = nodePositions.get(a)
        const posB = nodePositions.get(b)
        if (!posA || !posB) {
            return
        }
        const weight = distance(point(posA), point(posB), { units: 'meters' })

        const edgesA = adjacency.get(a)
        if (edgesA) {
            edgesA.push({ to: b, weight })
        } else {
            adjacency.set(a, [{ to: b, weight }])
        }

        const edgesB = adjacency.get(b)
        if (edgesB) {
            edgesB.push({ to: a, weight })
        } else {
            adjacency.set(b, [{ to: a, weight }])
        }
    }

    for (const way of ways) {
        for (let i = 1; i < way.nodes.length; i += 1) {
            addEdge(way.nodes[i - 1]!, way.nodes[i]!)
        }
    }

    return { nodes: nodePositions, adjacency }
}

interface HeapEntry {
    id: number
    dist: number
}

// A plain array-based binary min-heap. Dijkstra over a few tens of thousands of nodes
// needs this rather than a linear scan of the frontier for the next-closest node.
function heapPush(heap: HeapEntry[], entry: HeapEntry): void {
    heap.push(entry)
    let i = heap.length - 1
    while (i > 0) {
        const parent = (i - 1) >> 1
        if (heap[parent]!.dist <= heap[i]!.dist) {
            break
        }
        ;[heap[parent], heap[i]] = [heap[i]!, heap[parent]!]
        i = parent
    }
}

function heapPop(heap: HeapEntry[]): HeapEntry | undefined {
    const top = heap[0]
    const last = heap.pop()
    if (heap.length > 0 && last) {
        heap[0] = last
        let i = 0
        for (;;) {
            const left = 2 * i + 1
            const right = 2 * i + 2
            let smallest = i
            if (left < heap.length && heap[left]!.dist < heap[smallest]!.dist) {
                smallest = left
            }
            if (right < heap.length && heap[right]!.dist < heap[smallest]!.dist) {
                smallest = right
            }
            if (smallest === i) {
                break
            }
            ;[heap[smallest], heap[i]] = [heap[i]!, heap[smallest]!]
            i = smallest
        }
    }
    return top
}

/** Dijkstra shortest path between two graph nodes, or null when they are not connected. */
export function shortestPath(
    graph: RailGraph,
    fromId: number,
    toId: number,
): { nodeIds: number[]; distance: number } | null {
    if (fromId === toId) {
        return { nodeIds: [fromId], distance: 0 }
    }

    const dist = new Map<number, number>([[fromId, 0]])
    const prev = new Map<number, number>()
    const visited = new Set<number>()
    const heap: HeapEntry[] = []
    heapPush(heap, { id: fromId, dist: 0 })

    while (heap.length > 0) {
        const current = heapPop(heap)!
        if (visited.has(current.id)) {
            continue
        }
        visited.add(current.id)
        if (current.id === toId) {
            break
        }

        for (const edge of graph.adjacency.get(current.id) ?? []) {
            if (visited.has(edge.to)) {
                continue
            }
            const candidate = current.dist + edge.weight
            const known = dist.get(edge.to)
            if (known === undefined || candidate < known) {
                dist.set(edge.to, candidate)
                prev.set(edge.to, current.id)
                heapPush(heap, { id: edge.to, dist: candidate })
            }
        }
    }

    const finalDistance = dist.get(toId)
    if (finalDistance === undefined) {
        return null
    }

    const nodeIds: number[] = [toId]
    let cursor = toId
    while (cursor !== fromId) {
        const parent = prev.get(cursor)
        if (parent === undefined) {
            return null
        }
        nodeIds.push(parent)
        cursor = parent
    }
    nodeIds.reverse()

    return { nodeIds, distance: finalDistance }
}

/** The graph node nearest `coord`, or null when the closest one is still further than `maxDistanceMetres`. */
export function nearestNode(graph: RailGraph, coord: Position, maxDistanceMetres: number): number | null {
    let bestId: number | null = null
    let bestDistance = Infinity

    for (const [id, pos] of graph.nodes) {
        if (!graph.adjacency.has(id)) {
            continue
        }
        const d = distance(point(pos), point(coord), { units: 'meters' })
        if (d < bestDistance) {
            bestDistance = d
            bestId = id
        }
    }

    if (bestId === null || bestDistance > maxDistanceMetres) {
        return null
    }
    return bestId
}

/**
 * Snaps a pattern's stops to the rail graph and Dijkstras between each consecutive
 * pair, concatenating the legs and dropping the duplicated join node. Returns null
 * when a stop is too far from the network to snap, or when a leg has no path at
 * all — a disconnected fragment — rather than emitting a broken line.
 */
export function routeOnRailGraph(
    graph: RailGraph,
    stopCoords: Position[],
    opts: { maxSnapMetres?: number } = {},
): TrimmedLine | null {
    const { maxSnapMetres = 500 } = opts

    const snapped: number[] = []
    for (const coord of stopCoords) {
        const id = nearestNode(graph, coord, maxSnapMetres)
        if (id === null) {
            return null
        }
        snapped.push(id)
    }

    const first = graph.nodes.get(snapped[0]!)
    if (!first) {
        return null
    }

    const coordinates: Position[] = [first]
    const stopDistances: number[] = [0]
    let cumulative = 0

    for (let i = 1; i < snapped.length; i += 1) {
        const leg = shortestPath(graph, snapped[i - 1]!, snapped[i]!)
        if (!leg) {
            return null
        }
        for (let j = 1; j < leg.nodeIds.length; j += 1) {
            const pos = graph.nodes.get(leg.nodeIds[j]!)
            if (!pos) {
                return null
            }
            coordinates.push(pos)
        }
        cumulative += leg.distance
        stopDistances.push(cumulative)
    }

    return { coordinates, stopDistances }
}
