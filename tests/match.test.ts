import { describe, expect, it } from 'vitest'
import { cumulativeDistances, matchPatternGeometry, straightLine, trimToStops } from '../scripts/osm/match'
import type { Pattern, Stop } from '../src/types/network'
import type { PatternRouter } from '../scripts/osm/match'

const stops: Stop[] = [
    { id: 'a', name: 'A', lat: 48.7, lon: 16.8 },
    { id: 'b', name: 'B', lat: 48.75, lon: 16.8 },
    { id: 'c', name: 'C', lat: 48.8, lon: 16.8 },
]
const stopById = new Map(stops.map((s) => [s.id, s]))

const pattern: Pattern = {
    id: '563-0-1',
    line: '563',
    direction: 0,
    headsign: 'C',
    stops: ['a', 'b', 'c'],
    offsets: [0, 5, 10],
}

// A straight north-south line running past all three stops, and beyond them.
const corridor: [number, number][] = [
    [16.8, 48.6],
    [16.8, 48.7],
    [16.8, 48.75],
    [16.8, 48.8],
    [16.8, 48.9],
]

describe('cumulativeDistances', () => {
    it('measures zero at the first vertex and grows along the line', () => {
        const measured = cumulativeDistances([
            [16.8, 48.7],
            [16.8, 48.75],
            [16.8, 48.8],
        ])
        expect(measured[0]).toBe(0)
        expect(measured[1]!).toBeCloseTo(5560, -2)
        expect(measured[2]!).toBeCloseTo(11119, -2)
    })
})

describe('straightLine', () => {
    it('connects the pattern stops in order', () => {
        expect(straightLine(pattern, stopById)).toEqual([
            [16.8, 48.7],
            [16.8, 48.75],
            [16.8, 48.8],
        ])
    })
})

describe('trimToStops', () => {
    it('cuts the corridor down to the span between first and last stop', () => {
        const trimmed = trimToStops(
            corridor,
            [
                [16.8, 48.7],
                [16.8, 48.8],
            ],
            250,
        )!
        const coords = trimmed.coordinates
        expect(coords[0]![1]).toBeCloseTo(48.7, 4)
        expect(coords[coords.length - 1]![1]).toBeCloseTo(48.8, 4)
    })

    it('reports each stop distance along the trimmed line, starting at zero', () => {
        // 0.10 degrees of latitude is about 11.1 km; the first stop anchors the origin.
        const trimmed = trimToStops(
            corridor,
            [
                [16.8, 48.7],
                [16.8, 48.75],
                [16.8, 48.8],
            ],
            250,
        )!
        expect(trimmed.stopDistances).toHaveLength(3)
        expect(trimmed.stopDistances[0]).toBe(0)
        expect(trimmed.stopDistances[1]!).toBeCloseTo(5560, -2)
        expect(trimmed.stopDistances[2]!).toBeCloseTo(11119, -2)
    })

    it('reverses the line when the stops run against its direction', () => {
        const reversed = [...corridor].reverse()
        const trimmed = trimToStops(
            reversed,
            [
                [16.8, 48.7],
                [16.8, 48.8],
            ],
            250,
        )!
        const coords = trimmed.coordinates
        expect(coords[0]![1]).toBeCloseTo(48.7, 4)
        expect(coords[coords.length - 1]![1]).toBeCloseTo(48.8, 4)
    })

    it('rejects a line the stops do not lie near', () => {
        const elsewhere: [number, number][] = [
            [17.5, 48.6],
            [17.5, 48.9],
        ]
        expect(
            trimToStops(
                elsewhere,
                [
                    [16.8, 48.7],
                    [16.8, 48.8],
                ],
                250,
            ),
        ).toBeNull()
    })

    it('rejects a line the stops do not traverse monotonically', () => {
        // Stops in an order the corridor cannot produce: middle, start, end.
        const shuffled: [number, number][] = [
            [16.8, 48.75],
            [16.8, 48.7],
            [16.8, 48.8],
        ]
        expect(trimToStops(corridor, shuffled, 250)).toBeNull()
    })
})

describe('matchPatternGeometry', () => {
    it('prefers an explicit override', async () => {
        const override: [number, number][] = [
            [1, 1],
            [2, 2],
        ]
        const result = await matchPatternGeometry({ pattern, stops: stopById, relations: [], override })
        expect(result.source).toBe('override')
        expect(result.coordinates).toEqual(override)
        expect(result.stopDistances).toHaveLength(3)
    })

    it('uses a matching OSM relation', async () => {
        const result = await matchPatternGeometry({
            pattern,
            stops: stopById,
            relations: [{ ref: '563', coordinates: corridor }],
        })
        expect(result.source).toBe('osm')
        expect(result.coordinates[0]![1]).toBeCloseTo(48.7, 4)
    })

    it('falls back to straight lines when no relation matches the line ref', async () => {
        const result = await matchPatternGeometry({
            pattern,
            stops: stopById,
            relations: [{ ref: '999', coordinates: corridor }],
        })
        expect(result.source).toBe('straight')
        expect(result.coordinates).toEqual([
            [16.8, 48.7],
            [16.8, 48.75],
            [16.8, 48.8],
        ])
        expect(result.stopDistances[0]).toBe(0)
        expect(result.stopDistances[2]!).toBeCloseTo(11119, -2)
    })

    it('falls back to straight lines when the matching relation is nowhere near the stops', async () => {
        const result = await matchPatternGeometry({
            pattern,
            stops: stopById,
            relations: [
                {
                    ref: '563',
                    coordinates: [
                        [17.5, 48.6],
                        [17.5, 48.9],
                    ],
                },
            ],
        })
        expect(result.source).toBe('straight')
    })

    it('picks the relation variant that fits best when several share a ref', async () => {
        const short: [number, number][] = [
            [16.8, 48.7],
            [16.8, 48.75],
        ]
        const result = await matchPatternGeometry({
            pattern,
            stops: stopById,
            relations: [
                { ref: '563', coordinates: short },
                { ref: '563', coordinates: corridor },
            ],
        })
        // The short variant does not reach stop 'c', so the corridor must win.
        expect(result.source).toBe('osm')
        expect(result.coordinates[result.coordinates.length - 1]![1]).toBeCloseTo(48.8, 4)
    })
})

describe('matchPatternGeometry tier order', () => {
    // These assert the order override > relation > router > straight. Each test would fail
    // if a lower tier's result won, or if a higher tier were skipped in favour of the router.

    it('never calls the router when an explicit override is present', async () => {
        let called = false
        const router: PatternRouter = () => {
            called = true
            return Promise.resolve({ coordinates: [], stopDistances: [] })
        }
        const override: [number, number][] = [
            [1, 1],
            [2, 2],
        ]
        const result = await matchPatternGeometry({ pattern, stops: stopById, relations: [], override, router })
        expect(result.source).toBe('override')
        expect(called).toBe(false)
    })

    it('never calls the router when a relation already fits the pattern', async () => {
        let called = false
        const router: PatternRouter = () => {
            called = true
            return Promise.resolve({ coordinates: [[9, 9]], stopDistances: [0] })
        }
        const result = await matchPatternGeometry({
            pattern,
            stops: stopById,
            relations: [{ ref: '563', coordinates: corridor }],
            router,
        })
        expect(result.source).toBe('osm')
        expect(called).toBe(false)
    })

    it('calls the router and uses its result when no relation matches', async () => {
        let called = false
        const routed = {
            coordinates: [
                [9, 9],
                [9.1, 9.1],
            ] as [number, number][],
            stopDistances: [0, 42],
        }
        const router: PatternRouter = () => {
            called = true
            return Promise.resolve(routed)
        }
        const result = await matchPatternGeometry({ pattern, stops: stopById, relations: [], router })
        expect(called).toBe(true)
        expect(result.source).toBe('routed')
        expect(result.coordinates).toEqual(routed.coordinates)
        expect(result.stopDistances).toEqual(routed.stopDistances)
    })

    it('falls back to a straight line when the router cannot route the pattern', async () => {
        const router: PatternRouter = () => Promise.resolve(null)
        const result = await matchPatternGeometry({ pattern, stops: stopById, relations: [], router })
        expect(result.source).toBe('straight')
        expect(result.coordinates).toEqual(straightLine(pattern, stopById))
    })

    it('falls back to a straight line when no router is injected at all', async () => {
        const result = await matchPatternGeometry({ pattern, stops: stopById, relations: [] })
        expect(result.source).toBe('straight')
    })
})
