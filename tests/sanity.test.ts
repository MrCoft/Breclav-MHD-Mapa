import { describe, expect, it } from 'vitest'
import { assertGeometrySane, assertSane } from '../scripts/build-network'
import { loadScope } from '../scripts/gtfs/read'
import { cumulativeDistances } from '../scripts/osm/match'
import { tinyNetwork } from './fixtures/tinyNetwork'
import type { GeometryDiagnostics, GeometryFeature } from '../scripts/build-network'
import type { Network } from '../src/types/network'

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

describe('assertGeometrySane', () => {
    // A plain 2-vertex line ~1002m long, with two stops that exactly bracket it — every one of
    // the feature-level checks (starts at 0, monotonic, final stop near the line's own length)
    // is satisfied by construction, so these tests isolate the diagnostics-driven checks below.
    const coordinates: [number, number][] = [
        [16.8, 48.7],
        [16.8, 48.709],
    ]
    const lineLength = cumulativeDistances(coordinates).at(-1)!
    const feature: GeometryFeature = {
        type: 'Feature',
        properties: {
            patternId: 'p1',
            lineId: 'L',
            lineName: 'L',
            mode: 'bus',
            color: '#000000',
            source: 'osm',
            stopDistances: [0, lineLength],
        },
        geometry: { type: 'LineString', coordinates },
    }

    it('accepts diagnostics well within both thresholds', () => {
        const diagnostics: GeometryDiagnostics[] = [{ patternId: 'p1', maxOffMetres: 1, maxClampMetres: 0 }]
        expect(() => assertGeometrySane([feature], diagnostics)).not.toThrow()
    })

    // Finding 1's fix: remeasureSimplified's non-decreasing floor makes stopDistances itself
    // always look monotonic, even when the search it floored actually went backwards — so this
    // is the one place left that can still see, and must reject, a real interior backward jump.
    it('rejects a pattern where the monotonicity floor had to correct a real backward jump', () => {
        const diagnostics: GeometryDiagnostics[] = [{ patternId: 'p1', maxOffMetres: 1, maxClampMetres: 50 }]
        expect(() => assertGeometrySane([feature], diagnostics)).toThrow(/p1.*floor|monotonicity floor.*p1/is)
    })

    it('tolerates the floor absorbing only floating-point noise', () => {
        const diagnostics: GeometryDiagnostics[] = [{ patternId: 'p1', maxOffMetres: 1, maxClampMetres: 0.001 }]
        expect(() => assertGeometrySane([feature], diagnostics)).not.toThrow()
    })

    // Finding 2's fix: maxOffMetres was computed by remeasureSimplified and thrown away by its
    // only caller. Surfaced and gated here instead.
    it('rejects a pattern whose worst stop-to-line offset blows past the threshold', () => {
        const diagnostics: GeometryDiagnostics[] = [{ patternId: 'p1', maxOffMetres: 600, maxClampMetres: 0 }]
        expect(() => assertGeometrySane([feature], diagnostics)).toThrow(/p1.*projected|projected.*p1/is)
    })

    it('tolerates an offset up to the rail tier’s own 500m snap allowance plus margin', () => {
        // Measured on the real dataset: routeOnRailGraph's own maxSnapMetres (500m) legitimately
        // produces offsets up to ~221m for a rail pattern ending at a non-rail stop. 500m itself
        // must still pass.
        const diagnostics: GeometryDiagnostics[] = [{ patternId: 'p1', maxOffMetres: 500, maxClampMetres: 0 }]
        expect(() => assertGeometrySane([feature], diagnostics)).not.toThrow()
    })
})
