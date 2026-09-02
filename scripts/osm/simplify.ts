import type { Position } from './match'

const METRES_PER_DEGREE_LAT = 111320

/**
 * Projects a lon/lat coordinate to local planar metres around a reference latitude. A degree
 * of longitude is shorter than a degree of latitude away from the equator, and Břeclav sits at
 * 48.8°N, so comparing raw lon/lat degrees would silently distort the tolerance passed to
 * `simplifyLine`. This projection is only used to rank candidate points against a metre
 * tolerance, not to relocate anything, so a single reference latitude per line is accurate
 * enough over a pattern's few-kilometre extent.
 */
function toLocalMetres(coord: Position, refLat: number): [number, number] {
    const metresPerDegreeLon = METRES_PER_DEGREE_LAT * Math.cos((refLat * Math.PI) / 180)
    return [coord[0] * metresPerDegreeLon, coord[1] * METRES_PER_DEGREE_LAT]
}

/** Perpendicular distance, in the same units as the points, from `point` to the infinite line through `a` and `b`. */
function perpendicularDistance(point: [number, number], a: [number, number], b: [number, number]): number {
    const [px, py] = point
    const [ax, ay] = a
    const [bx, by] = b
    const dx = bx - ax
    const dy = by - ay
    if (dx === 0 && dy === 0) {
        return Math.hypot(px - ax, py - ay)
    }
    const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    const projX = ax + t * dx
    const projY = ay + t * dy
    return Math.hypot(px - projX, py - projY)
}

/**
 * The indices Ramer-Douglas-Peucker keeps out of `coordinates` at `toleranceMetres`: each kept
 * vertex sits further than the tolerance from the chord spanning its surviving neighbours, so
 * long straight or near-straight runs collapse to their endpoints while corners, curves and
 * roundabouts — which deviate from any chord — survive. Implemented directly rather than
 * pulling in `@turf/simplify`, since the algorithm is short, has no dependencies of its own,
 * and the package is not already used anywhere in this codebase.
 *
 * Never simplifies below 2 points: a line with 2 or fewer vertices keeps every index, and the
 * first and last indices of any longer line are always kept. Exposed separately from
 * `simplifyLine` (which is the one most callers want) because the converter also needs the
 * correspondence between original and simplified vertices, to recompute stop distances against
 * the simplified line without losing track of which original stretch a given simplified
 * segment stands in for.
 */
export function simplifyIndices(coordinates: Position[], toleranceMetres: number): number[] {
    if (coordinates.length <= 2) {
        return coordinates.map((_, i) => i)
    }

    const refLat = coordinates[Math.floor(coordinates.length / 2)]![1]
    const projected = coordinates.map((c) => toLocalMetres(c, refLat))

    const keep = new Array<boolean>(coordinates.length).fill(false)
    keep[0] = true
    keep[coordinates.length - 1] = true

    const stack: [number, number][] = [[0, coordinates.length - 1]]
    while (stack.length > 0) {
        const [start, end] = stack.pop()!
        let maxDistance = 0
        let maxIndex = -1
        for (let i = start + 1; i < end; i += 1) {
            const d = perpendicularDistance(projected[i]!, projected[start]!, projected[end]!)
            if (d > maxDistance) {
                maxDistance = d
                maxIndex = i
            }
        }
        if (maxDistance > toleranceMetres) {
            keep[maxIndex] = true
            stack.push([start, maxIndex])
            stack.push([maxIndex, end])
        }
    }

    const indices: number[] = []
    for (let i = 0; i < keep.length; i += 1) {
        if (keep[i]) {
            indices.push(i)
        }
    }
    return indices
}

/** Ramer-Douglas-Peucker line simplification — see `simplifyIndices` for how it chooses vertices. */
export function simplifyLine(coordinates: Position[], toleranceMetres: number): Position[] {
    if (coordinates.length <= 2) {
        return coordinates
    }
    return simplifyIndices(coordinates, toleranceMetres).map((i) => coordinates[i]!)
}
