import { describe, expect, it } from 'vitest'
import { buildPatternGeometry, positionAt } from '../src/domain/patternGeometry'
import type { PatternGeometryProperties } from '../src/domain/patternGeometry'
import type { Feature, LineString } from 'geojson'

// Must match the constant `patternGeometry.ts` uses internally, so that a metre value chosen
// here reproduces exactly as the same metre value once run back through the haversine formula.
const EARTH_RADIUS_METRES = 6371000

/**
 * Degrees of longitude that cover `metres` at the equator. At the equator a haversine distance
 * with no latitude change reduces exactly to `R * deltaLongitudeRadians` (the great-circle arc
 * length identity), so points built with this offset are `metres` apart by construction — this
 * is the "compute the expected positions by hand" the brief asks for, not a call into the code
 * under test.
 */
function lonOffsetForMetres(metres: number): number {
    return (metres / EARTH_RADIUS_METRES) * (180 / Math.PI)
}

const BASE_LON = 16.9

/** A straight line due east along the equator, vertices at the given cumulative metre marks. */
function equatorLineFeature(cumulativeMetres: number[]): Feature<LineString, PatternGeometryProperties> {
    return {
        type: 'Feature',
        properties: { patternId: 'p', stopDistances: cumulativeMetres },
        geometry: {
            type: 'LineString',
            coordinates: cumulativeMetres.map((m) => [BASE_LON + lonOffsetForMetres(m), 0]),
        },
    }
}

// Three 1000 m segments: vertices at 0, 1000, 2000, 3000 metres.
const eastward = buildPatternGeometry(equatorLineFeature([0, 1000, 2000, 3000]))

describe('positionAt', () => {
    it('returns the start point at metres 0', () => {
        const p = positionAt(eastward, 0)
        expect(p.lon).toBeCloseTo(BASE_LON, 9)
        expect(p.lat).toBeCloseTo(0, 9)
    })

    it('returns the end point at the exact total length', () => {
        const p = positionAt(eastward, 3000)
        expect(p.lon).toBeCloseTo(BASE_LON + lonOffsetForMetres(3000), 9)
        expect(p.lat).toBeCloseTo(0, 9)
    })

    it('lands exactly on an interior vertex', () => {
        const p = positionAt(eastward, 1000)
        expect(p.lon).toBeCloseTo(BASE_LON + lonOffsetForMetres(1000), 9)
        expect(p.lat).toBeCloseTo(0, 9)
    })

    it('interpolates midway through a segment', () => {
        const p = positionAt(eastward, 500)
        expect(p.lon).toBeCloseTo(BASE_LON + lonOffsetForMetres(500), 9)
        expect(p.lat).toBeCloseTo(0, 9)
    })

    it('clamps rather than extrapolating before the start', () => {
        const p = positionAt(eastward, -1000)
        expect(p.lon).toBeCloseTo(BASE_LON, 9)
        expect(p.lat).toBeCloseTo(0, 9)
    })

    it('clamps rather than extrapolating past the end', () => {
        const p = positionAt(eastward, 10000)
        expect(p.lon).toBeCloseTo(BASE_LON + lonOffsetForMetres(3000), 9)
        expect(p.lat).toBeCloseTo(0, 9)
    })

    it('reports a bearing due east along an eastward line', () => {
        const p = positionAt(eastward, 1500)
        expect(p.bearing).toBeCloseTo(90, 6)
    })

    it('reports a bearing due north along a northward line', () => {
        const northward = buildPatternGeometry(
            buildTwoPointFeature([16.9, 48.7], [16.9, 48.71]), // same longitude, increasing latitude
        )
        const p = positionAt(northward, 0)
        expect(p.bearing).toBeCloseTo(0, 6)
    })
})

function buildTwoPointFeature(
    a: [number, number],
    b: [number, number],
): Feature<LineString, PatternGeometryProperties> {
    return {
        type: 'Feature',
        properties: { patternId: 'p', stopDistances: [0] },
        geometry: { type: 'LineString', coordinates: [a, b] },
    }
}
