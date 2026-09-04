import { describe, expect, it } from 'vitest'
import { assertGeometrySane, assertSane, assertStructurallySane, lengthToleranceMetres } from '../scripts/build-network'
import { loadScope } from '../scripts/gtfs/read'
import { cumulativeDistances } from '../scripts/osm/match'
import { tinyNetwork } from './fixtures/tinyNetwork'
import type { GeometryDiagnostics, GeometryFeature } from '../scripts/build-network'
import type { Network, Pattern } from '../src/types/network'

const scope = { ...loadScope(), expectedRoutes: { min: 1, max: 5 } }

describe('assertSane', () => {
    it('accepts a plausible network', () => {
        expect(() => assertSane(tinyNetwork, scope)).not.toThrow()
    })

    it('rejects a route count outside the expected band', () => {
        expect(() => assertSane(tinyNetwork, { ...scope, expectedRoutes: { min: 10, max: 20 } })).toThrow(/lines/i)
    })

    it('rejects a network with no trips', () => {
        const empty: Network = { ...structuredClone(tinyNetwork), trips: [] }
        expect(() => assertSane(empty, scope)).toThrow(/trips/i)
    })

    it('rejects a stop that no pattern serves', () => {
        const orphan: Network = structuredClone(tinyNetwork)
        orphan.stops.push({ id: 'z', name: 'Nikde', lat: 48, lon: 16 })
        expect(() => assertSane(orphan, scope)).toThrow(/z/)
    })
})

describe('assertStructurallySane', () => {
    // Finding I4: the proposal's 10 lines fail the route-count band `assertSane` gates, but the
    // three structural checks below apply to it just as much as to the GTFS-derived network.
    it('accepts a plausible network with a route count `assertSane` would reject', () => {
        const tenLines: Network = {
            ...structuredClone(tinyNetwork),
            lines: Array.from({ length: 10 }, (_, i) => ({ ...tinyNetwork.lines[0]!, id: `L${i}`, name: `L${i}` })),
        }
        expect(() => assertSane(tenLines, { ...scope, expectedRoutes: { min: 15, max: 30 } })).toThrow(/lines/i)
        expect(() => assertStructurallySane(tenLines)).not.toThrow()
    })

    it('rejects a network with no trips', () => {
        const empty: Network = { ...structuredClone(tinyNetwork), trips: [] }
        expect(() => assertStructurallySane(empty)).toThrow(/trips/i)
    })

    it('rejects a pattern with fewer than 2 stops', () => {
        const short: Network = structuredClone(tinyNetwork)
        short.patterns[0]!.stops = ['a']
        expect(() => assertStructurallySane(short)).toThrow(/fewer than 2 stops/i)
    })

    it('rejects a stop that no pattern serves', () => {
        const orphan: Network = structuredClone(tinyNetwork)
        orphan.stops.push({ id: 'z', name: 'Nikde', lat: 48, lon: 16 })
        expect(() => assertStructurallySane(orphan)).toThrow(/z/)
    })
})

describe('lengthToleranceMetres', () => {
    it('is 6m at zero length and 31.9m over the 129.5km that prompted decision 33', () => {
        expect(lengthToleranceMetres(0)).toBeCloseTo(6, 6)
        expect(lengthToleranceMetres(129_500)).toBeCloseTo(31.9, 6)
    })
})

describe('assertGeometrySane', () => {
    // A plain 2-vertex line ~1002m long, with two stops that exactly bracket it — every one of
    // the feature-level checks (starts at 0, monotonic, final stop near the line's own length)
    // is satisfied by construction, so these tests isolate the diagnostics-driven checks below.
    const coordinates: [number, number][] = [
        [16.8, 48.7],
        [16.8, 48.709],
    ]
    const lineLength = cumulativeDistances(coordinates).at(-1)!

    function busFeature(overrides: Partial<GeometryFeature['properties']> = {}): GeometryFeature {
        return {
            type: 'Feature',
            properties: {
                patternId: 'p1',
                lineId: 'L',
                lineName: 'L',
                mode: 'bus',
                color: '#000000',
                source: 'osm',
                stopDistances: [0, lineLength],
                ...overrides,
            },
            geometry: { type: 'LineString', coordinates },
        }
    }

    const feature = busFeature()
    // No pattern named 'p1' — the offsets/stopDistances length check (finding I6, below) is
    // skipped whenever a feature's pattern can't be found, which is what isolates every test
    // above this comment to the diagnostics-driven checks it means to exercise.
    const noPatterns: Pattern[] = []

    it('accepts diagnostics well within both thresholds', () => {
        const diagnostics: GeometryDiagnostics[] = [{ patternId: 'p1', maxOffMetres: 1, maxClampMetres: 0 }]
        expect(() => assertGeometrySane([feature], diagnostics, noPatterns)).not.toThrow()
    })

    // Finding 1's fix: remeasureSimplified's non-decreasing floor makes stopDistances itself
    // always look monotonic, even when the search it floored actually went backwards — so this
    // is the one place left that can still see, and must reject, a real interior backward jump.
    it('rejects a pattern where the monotonicity floor had to correct a real backward jump', () => {
        const diagnostics: GeometryDiagnostics[] = [{ patternId: 'p1', maxOffMetres: 1, maxClampMetres: 50 }]
        expect(() => assertGeometrySane([feature], diagnostics, noPatterns)).toThrow(
            /p1.*floor|monotonicity floor.*p1/is,
        )
    })

    it('tolerates the floor absorbing only floating-point noise', () => {
        const diagnostics: GeometryDiagnostics[] = [{ patternId: 'p1', maxOffMetres: 1, maxClampMetres: 0.001 }]
        expect(() => assertGeometrySane([feature], diagnostics, noPatterns)).not.toThrow()
    })

    // Finding 2's fix: maxOffMetres was computed by remeasureSimplified and thrown away by its
    // only caller. Surfaced and gated here instead.
    it('rejects a pattern whose worst stop-to-line offset blows past the threshold', () => {
        const diagnostics: GeometryDiagnostics[] = [{ patternId: 'p1', maxOffMetres: 600, maxClampMetres: 0 }]
        expect(() => assertGeometrySane([feature], diagnostics, noPatterns)).toThrow(/p1.*projected|projected.*p1/is)
    })

    it('tolerates an offset up to the rail tier’s own 500m snap allowance plus margin', () => {
        // Measured on the real dataset: routeOnRailGraph's own maxSnapMetres (500m) legitimately
        // produces offsets up to ~221m for a rail pattern ending at a non-rail stop. 500m itself
        // must still pass — for rail. See the next two tests for why bus does not get the same
        // allowance (finding I7).
        const railFeature = busFeature({ mode: 'rail' })
        const diagnostics: GeometryDiagnostics[] = [{ patternId: 'p1', maxOffMetres: 500, maxClampMetres: 0 }]
        expect(() => assertGeometrySane([railFeature], diagnostics, noPatterns)).not.toThrow()
    })

    // Finding I7: one shared 520m tolerance was wide enough for rail but not a meaningful gate
    // for bus, whose measured worst case (208.2m, across every currently-committed bus pattern)
    // is nowhere near it. A bus pattern is now gated at 250m instead.
    it('tolerates a bus offset within the tighter bus-specific allowance', () => {
        const diagnostics: GeometryDiagnostics[] = [{ patternId: 'p1', maxOffMetres: 220, maxClampMetres: 0 }]
        expect(() => assertGeometrySane([feature], diagnostics, noPatterns)).not.toThrow()
    })

    it('rejects a bus offset that would pass under rail’s allowance but exceeds bus’s own', () => {
        const diagnostics: GeometryDiagnostics[] = [{ patternId: 'p1', maxOffMetres: 400, maxClampMetres: 0 }]
        expect(() => assertGeometrySane([feature], diagnostics, noPatterns)).toThrow(/p1.*projected|projected.*p1/is)
    })

    // Finding I6: `vehiclesAt` (src/domain/vehicles.ts) silently skips every trip on a pattern
    // whose `offsets` and this geometry's `stopDistances` disagree in length — dev-console-only,
    // so a production build never surfaces it. Asserted here at build time instead.
    it('rejects a pattern whose offsets and stopDistances lengths disagree', () => {
        const pattern: Pattern = {
            id: 'p1',
            line: 'L',
            direction: 0,
            headsign: 'X',
            stops: ['a', 'b', 'c'],
            offsets: [0, 5, 10], // 3 offsets against this feature's 2 stopDistances
        }
        const diagnostics: GeometryDiagnostics[] = [{ patternId: 'p1', maxOffMetres: 1, maxClampMetres: 0 }]
        expect(() => assertGeometrySane([feature], diagnostics, [pattern])).toThrow(/p1.*offsets.*stopDistances/is)
    })

    it('accepts a pattern whose offsets and stopDistances lengths agree', () => {
        const pattern: Pattern = {
            id: 'p1',
            line: 'L',
            direction: 0,
            headsign: 'X',
            stops: ['a', 'b'],
            offsets: [0, 10],
        }
        const diagnostics: GeometryDiagnostics[] = [{ patternId: 'p1', maxOffMetres: 1, maxClampMetres: 0 }]
        expect(() => assertGeometrySane([feature], diagnostics, [pattern])).not.toThrow()
    })

    // Decision 33: the final-length gate scales with the line, so the two directions it moved in
    // need separate cases — it is roughly 2.4x tighter than the old flat 20m at 11km and only
    // widens past 20m beyond about 70km. A meridian line's distance is R·Δφ, so a target length
    // converts straight into a latitude delta; each test asserts the length it actually built
    // before exercising the gate, since the length is what picks the tolerance.
    const METRES_PER_DEGREE_LATITUDE = 111195.08

    function featureMissingItsLengthBy(lengthMetres: number, missMetres: number): GeometryFeature {
        const coords: [number, number][] = [
            [16.8, 48.7],
            [16.8, 48.7 + lengthMetres / METRES_PER_DEGREE_LATITUDE],
        ]
        const measured = cumulativeDistances(coords).at(-1)!
        return {
            ...busFeature({ stopDistances: [0, measured - missMetres] }),
            geometry: { type: 'LineString', coordinates: coords },
        }
    }

    it('rejects an 11km line missing by 12m, which the old flat 20m gate accepted', () => {
        const shortFeature = featureMissingItsLengthBy(11_000, 12)
        expect(cumulativeDistances(shortFeature.geometry.coordinates).at(-1)!).toBeCloseTo(11_000, 0)
        const diagnostics: GeometryDiagnostics[] = [{ patternId: 'p1', maxOffMetres: 1, maxClampMetres: 0 }]
        // 11km buys 8.2m, so 12m is a failure now even though it is well under the old 20m.
        expect(() => assertGeometrySane([shortFeature], diagnostics, noPatterns)).toThrow(
            /p1.*final stopDistance|final stopDistance.*p1/is,
        )
    })

    it('accepts a 129.5km line missing by 22.1m — the S8-0-12 case that prompted decision 33', () => {
        const longFeature = featureMissingItsLengthBy(129_500, 22.1)
        expect(cumulativeDistances(longFeature.geometry.coordinates).at(-1)!).toBeCloseTo(129_500, 0)
        const diagnostics: GeometryDiagnostics[] = [{ patternId: 'p1', maxOffMetres: 1, maxClampMetres: 0 }]
        // 129.5km buys 31.9m, against the 20m that failed this build.
        expect(() => assertGeometrySane([longFeature], diagnostics, noPatterns)).not.toThrow()
    })
})
