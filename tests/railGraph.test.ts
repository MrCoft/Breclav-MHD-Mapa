import { describe, expect, it } from 'vitest'
import { buildRailGraph, nearestNode, routeOnRailGraph, shortestPath } from '../scripts/osm/railGraph'
import type { RailGraph } from '../scripts/osm/railGraph'
import type { Position } from '../scripts/osm/match'
import type { OsmNode, OsmWay } from '../scripts/osm/overpass'

describe('buildRailGraph', () => {
    it('builds undirected, distance-weighted edges between consecutive nodes of each way', () => {
        const nodes: OsmNode[] = [
            { type: 'node', id: 1, lat: 48.7, lon: 16.8 },
            { type: 'node', id: 2, lat: 48.71, lon: 16.8 },
            { type: 'node', id: 3, lat: 48.72, lon: 16.8 },
        ]
        const ways: OsmWay[] = [{ type: 'way', id: 100, nodes: [1, 2, 3] }]

        const graph = buildRailGraph(ways, nodes)

        expect(graph.adjacency.get(1)?.map((e) => e.to)).toEqual([2])
        expect([...(graph.adjacency.get(2) ?? [])].map((e) => e.to).sort()).toEqual([1, 3])
        expect(graph.adjacency.get(3)?.map((e) => e.to)).toEqual([2])
        // Weighted by great-circle distance, not a hop count of 1.
        expect(graph.adjacency.get(1)?.[0]?.weight).toBeGreaterThan(1000)
        expect(graph.adjacency.get(1)?.[0]?.weight).toBeCloseTo(graph.adjacency.get(2)?.[0]?.weight ?? -1, 5)
    })

    it('joins ways that share an endpoint into one connected graph', () => {
        const nodes: OsmNode[] = [
            { type: 'node', id: 1, lat: 48.7, lon: 16.8 },
            { type: 'node', id: 2, lat: 48.71, lon: 16.8 },
            { type: 'node', id: 3, lat: 48.72, lon: 16.8 },
        ]
        const ways: OsmWay[] = [
            { type: 'way', id: 100, nodes: [1, 2] },
            { type: 'way', id: 101, nodes: [2, 3] },
        ]

        const graph = buildRailGraph(ways, nodes)
        expect(shortestPath(graph, 1, 3)).not.toBeNull()
    })
})

/**
 * A diamond where the locally-cheapest first hop is a trap: A-B is the shortest
 * single edge (1 m) but dead-ends into a long B-D edge (10 m), while the less
 * obviously attractive A-C-D route (5 m + 1 m = 6 m) is actually shorter overall.
 * A naive walk that always steps to the nearest unvisited neighbour picks A-B-D
 * (distance 11) and gets this wrong; Dijkstra must find A-C-D (distance 6).
 */
function diamondGraph(): RailGraph {
    const nodes = new Map<number, Position>([
        [1, [16.8, 48.7]], // A
        [2, [16.81, 48.7]], // B
        [3, [16.82, 48.7]], // C
        [4, [16.83, 48.7]], // D
    ])
    const adjacency = new Map<number, { to: number; weight: number }[]>([
        [
            1,
            [
                { to: 2, weight: 1 },
                { to: 3, weight: 5 },
            ],
        ],
        [
            2,
            [
                { to: 1, weight: 1 },
                { to: 4, weight: 10 },
            ],
        ],
        [
            3,
            [
                { to: 1, weight: 5 },
                { to: 4, weight: 1 },
            ],
        ],
        [
            4,
            [
                { to: 2, weight: 10 },
                { to: 3, weight: 1 },
            ],
        ],
    ])
    return { nodes, adjacency }
}

describe('shortestPath', () => {
    it('finds the true shortest path even when the cheapest first hop leads the wrong way', () => {
        const graph = diamondGraph()
        const result = shortestPath(graph, 1, 4)
        expect(result).not.toBeNull()
        expect(result!.distance).toBe(6)
        expect(result!.nodeIds).toEqual([1, 3, 4])
    })

    it('returns a zero-length path when start and end are the same node', () => {
        const graph = diamondGraph()
        expect(shortestPath(graph, 1, 1)).toEqual({ nodeIds: [1], distance: 0 })
    })

    it('returns null when there is no path between the nodes', () => {
        const graph = diamondGraph()
        graph.nodes.set(5, [16.9, 48.7])
        graph.adjacency.set(5, [])
        expect(shortestPath(graph, 1, 5)).toBeNull()
    })
})

describe('nearestNode', () => {
    it('snaps a coordinate to the nearest graph node', () => {
        const graph = diamondGraph()
        // Much closer to B [16.81, 48.7] than to A [16.8, 48.7].
        expect(nearestNode(graph, [16.809, 48.7], 500)).toBe(2)
    })

    it('rejects a coordinate too far from the network', () => {
        const graph = diamondGraph()
        expect(nearestNode(graph, [20, 48.7], 500)).toBeNull()
    })
})

describe('routeOnRailGraph', () => {
    it('routes consecutive stops through the graph, with stopDistances starting at 0', () => {
        const graph = diamondGraph()
        const result = routeOnRailGraph(graph, [
            [16.8, 48.7], // snaps to A
            [16.83, 48.7], // snaps to D
        ])
        expect(result).not.toBeNull()
        expect(result!.stopDistances[0]).toBe(0)
        expect(result!.stopDistances[1]).toBe(6)
        expect(result!.coordinates[0]).toEqual([16.8, 48.7])
        expect(result!.coordinates[result!.coordinates.length - 1]).toEqual([16.83, 48.7])
    })

    it('returns null when a stop is too far from the network to snap', () => {
        const graph = diamondGraph()
        const result = routeOnRailGraph(graph, [
            [16.8, 48.7],
            [20, 48.7],
        ])
        expect(result).toBeNull()
    })

    it('returns null when a leg is disconnected, rather than emitting a broken line', () => {
        const graph = diamondGraph()
        graph.nodes.set(5, [16.9, 48.7])
        graph.adjacency.set(5, [])
        const result = routeOnRailGraph(graph, [
            [16.8, 48.7], // A
            [16.9, 48.7], // isolated node 5, no edges
        ])
        expect(result).toBeNull()
    })
})
