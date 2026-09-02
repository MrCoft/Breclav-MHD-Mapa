import { describe, expect, it } from 'vitest'
import {
    cumulativeDistances,
    matchPatternGeometry,
    remeasureSimplified,
    straightLine,
    trimToStops,
} from '../scripts/osm/match'
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

describe('remeasureSimplified', () => {
    // A line that runs north along longitude 16.8 from stop0, then loops back to pass within
    // ~2m of stop0 again (idx5) before finally heading off to stop1 far to the north (idx6).
    // Path length ("cumulative") only ever increases, so idx5 sits ~887m into the route despite
    // being almost on top of stop0 geographically — exactly the shape a bus terminus loop or an
    // out-and-back leg produces in the real network.
    const originalCoordinates: [number, number][] = [
        [16.8, 48.7], // idx0 — stop0's own position
        [16.8, 48.701], // idx1
        [16.8, 48.702], // idx2
        [16.8, 48.703], // idx3
        [16.8, 48.704], // idx4
        [16.8, 48.70003], // idx5 — the loop-back: ~2m from stop0, ~887m into the path
        [16.8, 48.8], // idx6 — stop1's own position
    ]
    // Simplification kept idx0, idx2, idx4, idx5 and idx6 — including the loop-back point,
    // exactly the case that makes an unrestricted nearest-point search dangerous.
    const keptIndices = [0, 2, 4, 5, 6]
    const simplifiedCoordinates = keptIndices.map((i) => originalCoordinates[i]!)
    const stopCoords: [number, number][] = [
        [16.8, 48.70005], // stop0, 5.6m north of idx0 — closer to the idx5 decoy (~2.2m) than to idx0
        [16.8, 48.8], // stop1, exactly at idx6
    ]

    it('anchors each stop near where the dense original line placed it, not wherever is geometrically nearest', () => {
        // Trusted distances from the tier that measured the ORIGINAL (dense) line: stop0 at its
        // own start (0), stop1 at the line's full length. Neither was computed by re-deriving
        // against the simplified line — that is exactly what remeasureSimplified must not do.
        const originalStopDistances = [0, cumulativeDistances(originalCoordinates).at(-1)!]

        const { along, maxOffMetres } = remeasureSimplified({
            originalCoordinates,
            originalStopDistances,
            simplifiedCoordinates,
            keptIndices,
            stopCoords,
        })

        expect(along).toHaveLength(2)
        // Correct: anchored to idx0's own segment, ~5.6m in. Wrong (what an unrestricted
        // nearest-point search would return instead): snapped onto the idx5 decoy, ~887m in.
        expect(along[0]!).toBeCloseTo(5.6, 0)
        expect(along[1]!).toBeCloseTo(cumulativeDistances(simplifiedCoordinates).at(-1)!, 0)
        expect(maxOffMetres).toBeLessThan(10)
    })

    it('never returns a distance smaller than the previous stop', () => {
        // Both stops anchored to the same point — a degenerate but legal input (two stops at
        // the same physical stand) — must not produce a pair that reads as moving backwards.
        const originalStopDistances = [0, 0]
        const twoStopCoords: [number, number][] = [
            [16.8, 48.70005],
            [16.8, 48.70005],
        ]
        const { along } = remeasureSimplified({
            originalCoordinates,
            originalStopDistances,
            simplifiedCoordinates,
            keptIndices,
            stopCoords: twoStopCoords,
        })
        expect(along[1]!).toBeGreaterThanOrEqual(along[0]!)
    })

    it('floors — and reports — a non-monotonic anchor sequence, rather than crashing or hiding it', () => {
        // Every tier except 'override' guarantees originalStopDistances is non-decreasing before
        // it ever reaches this function (straight and routed by construction; osm because
        // trimToStops rejects a non-monotonic relation outright). An override is hand-authored
        // and nothing validates its distances, so it is the one input shape that can arrive here
        // out of order — this is what that looks like: stop2's anchor (445m) is far behind
        // stop1's (~12016m, the line's own length).
        const fullLength = cumulativeDistances(originalCoordinates).at(-1)!
        const backwardsAnchor = cumulativeDistances(originalCoordinates)[4]! // idx4's position, ~445m
        const originalStopDistances = [0, fullLength, backwardsAnchor]
        const threeStopCoords: [number, number][] = [
            [16.8, 48.70005],
            [16.8, 48.8],
            [16.8, 48.704], // sits exactly at idx4 — where the (ignored) backwards anchor points
        ]

        const { along, maxClampMetres } = remeasureSimplified({
            originalCoordinates,
            originalStopDistances,
            simplifiedCoordinates,
            keptIndices,
            stopCoords: threeStopCoords,
        })

        // Degrades safely: the output itself never reads as moving backwards...
        expect(along[2]!).toBeGreaterThanOrEqual(along[1]!)
        // ...but that safety comes from flooring stop2 to stop1's own value, discarding
        // stop2's real (and, here, entirely valid) position — and Finding 1's fix is that this
        // is no longer silent: maxClampMetres reports the ~11,570m the floor had to correct,
        // which build-network.ts's MAX_CLAMP_TOLERANCE_METRES (0.01m) would fail on.
        expect(along[2]!).toBeCloseTo(along[1]!, 0)
        expect(maxClampMetres).toBeGreaterThan(1000)
    })
})
