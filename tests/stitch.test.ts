import { describe, expect, it } from 'vitest'
import { relationToLine, stitchWays } from '../scripts/osm/stitch'
import type { OsmNode, OsmRelation, OsmWay } from '../scripts/osm/overpass'

describe('stitchWays', () => {
    it('joins ways given in order', () => {
        expect(
            stitchWays([
                [1, 2, 3],
                [3, 4, 5],
            ]),
        ).toEqual([[1, 2, 3, 4, 5]])
    })

    it('joins ways given out of order', () => {
        expect(
            stitchWays([
                [3, 4, 5],
                [1, 2, 3],
            ]),
        ).toEqual([[1, 2, 3, 4, 5]])
    })

    it('reverses a way whose orientation is flipped', () => {
        expect(
            stitchWays([
                [1, 2, 3],
                [5, 4, 3],
            ]),
        ).toEqual([[1, 2, 3, 4, 5]])
    })

    it("joins ways that meet at the first way's start", () => {
        // Chain orientation is arbitrary — trimToStops resolves direction later by
        // trying the line both ways round — so this is the same path, reversed.
        expect(
            stitchWays([
                [3, 2, 1],
                [3, 4, 5],
            ]),
        ).toEqual([[5, 4, 3, 2, 1]])
    })

    it('returns disconnected groups as separate chains, longest first', () => {
        expect(
            stitchWays([
                [1, 2],
                [10, 11, 12, 13],
            ]),
        ).toEqual([
            [10, 11, 12, 13],
            [1, 2],
        ])
    })

    it('returns an empty array for no ways', () => {
        expect(stitchWays([])).toEqual([])
    })
})

describe('relationToLine', () => {
    it('resolves the longest chain to lon/lat positions', () => {
        const relation: OsmRelation = {
            type: 'relation',
            id: 1,
            tags: { ref: '563' },
            members: [
                { type: 'way', ref: 100, role: '' },
                { type: 'way', ref: 101, role: '' },
                { type: 'node', ref: 1, role: 'stop' },
            ],
        }
        const ways: OsmWay[] = [
            { type: 'way', id: 101, nodes: [3, 4] },
            { type: 'way', id: 100, nodes: [1, 2, 3] },
        ]
        const nodes: OsmNode[] = [
            { type: 'node', id: 1, lat: 48.75, lon: 16.88 },
            { type: 'node', id: 2, lat: 48.76, lon: 16.89 },
            { type: 'node', id: 3, lat: 48.77, lon: 16.9 },
            { type: 'node', id: 4, lat: 48.78, lon: 16.91 },
        ]

        expect(relationToLine(relation, ways, nodes)).toEqual([
            [16.88, 48.75],
            [16.89, 48.76],
            [16.9, 48.77],
            [16.91, 48.78],
        ])
    })

    it('ignores members with a role, which are stops rather than the path', () => {
        const relation: OsmRelation = {
            type: 'relation',
            id: 1,
            tags: {},
            members: [
                { type: 'way', ref: 100, role: '' },
                { type: 'way', ref: 999, role: 'platform' },
            ],
        }
        const ways: OsmWay[] = [
            { type: 'way', id: 100, nodes: [1, 2] },
            { type: 'way', id: 999, nodes: [50, 51] },
        ]
        const nodes: OsmNode[] = [
            { type: 'node', id: 1, lat: 1, lon: 1 },
            { type: 'node', id: 2, lat: 2, lon: 2 },
            { type: 'node', id: 50, lat: 9, lon: 9 },
            { type: 'node', id: 51, lat: 9, lon: 9 },
        ]

        expect(relationToLine(relation, ways, nodes)).toEqual([
            [1, 1],
            [2, 2],
        ])
    })
})
