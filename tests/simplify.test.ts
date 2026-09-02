import { describe, expect, it } from 'vitest'
import { simplifyLine } from '../scripts/osm/simplify'
import type { Position } from '../scripts/osm/match'

// Degrees of longitude that cover `metres` at latitude `lat`, using the same equirectangular
// approximation `simplifyLine` itself uses internally — so a metre value chosen here produces
// a perpendicular offset of exactly that many metres once run back through the function.
function lonOffsetForMetres(metres: number, lat: number): number {
    const metresPerDegreeLon = 111320 * Math.cos((lat * Math.PI) / 180)
    return metres / metresPerDegreeLon
}

describe('simplifyLine', () => {
    it('collapses a straight line of collinear points to its endpoints', () => {
        // All at the same longitude, so every interior point lies exactly on the chord
        // between the first and last — zero perpendicular distance, below any tolerance > 0.
        const line: Position[] = [
            [16.8, 48.7],
            [16.8, 48.72],
            [16.8, 48.74],
            [16.8, 48.76],
            [16.8, 48.78],
            [16.8, 48.8],
        ]
        const result = simplifyLine(line, 2)
        expect(result).toEqual([line[0], line[5]])
    })

    it('keeps a point that sits beyond the tolerance off the chord', () => {
        const midLat = 48.75
        const dLon = lonOffsetForMetres(10, midLat) // 10 m east of the chord, well past a 2 m tolerance
        const line: Position[] = [
            [16.8, 48.7],
            [16.8 + dLon, midLat],
            [16.8, 48.8],
        ]
        const result = simplifyLine(line, 2)
        expect(result).toEqual(line)
    })

    it('drops a point within the tolerance off the chord', () => {
        const midLat = 48.75
        const dLon = lonOffsetForMetres(0.5, midLat) // 0.5 m off the chord, inside a 2 m tolerance
        const line: Position[] = [
            [16.8, 48.7],
            [16.8 + dLon, midLat],
            [16.8, 48.8],
        ]
        const result = simplifyLine(line, 2)
        expect(result).toEqual([line[0], line[2]])
    })

    it('returns a two-point line unchanged', () => {
        const line: Position[] = [
            [16.8, 48.7],
            [16.9, 48.9],
        ]
        expect(simplifyLine(line, 2)).toEqual(line)
    })

    it('never drops the first or last point, regardless of tolerance', () => {
        // A zigzag with large deviations, so a naive implementation that only ever kept
        // the endpoints under a generous tolerance wouldn't distinguish this from the
        // endpoints-preserved property being tested.
        const line: Position[] = [
            [16.8, 48.7],
            [16.9, 48.72],
            [16.75, 48.74],
            [16.95, 48.76],
            [16.8, 48.8],
        ]
        const result = simplifyLine(line, 2)
        expect(result[0]).toBe(line[0])
        expect(result.at(-1)).toBe(line.at(-1))

        const untouched = simplifyLine(line, 50_000)
        expect(untouched[0]).toBe(line[0])
        expect(untouched.at(-1)).toBe(line.at(-1))
        expect(untouched).toHaveLength(2)
    })
})
