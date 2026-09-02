import type { Feature, LineString, Position } from 'geojson'

/** The properties `buildPatternGeometry` needs off a `geometry.geojson` feature. */
export interface PatternGeometryProperties {
    patternId: string
    /** Metres along this feature's line at each of the pattern's stops, same order as `pattern.stops`. */
    stopDistances: number[]
}

export interface LonLat {
    lon: number
    lat: number
}

/** A pattern's polyline, precomputed once so it can be queried by distance every frame. */
export interface PatternGeometry {
    patternId: string
    /** Vertex coordinates of the polyline, in travel order. */
    coordinates: LonLat[]
    /** Metres from the start of the polyline to each vertex. Same length as `coordinates`. */
    cumulative: number[]
    /** Metres along the polyline at each of the pattern's stops, same order as `pattern.stops`. */
    stopDistances: number[]
}

export interface PatternPosition {
    lon: number
    lat: number
    /** Degrees clockwise from north, 0-360 — what MapLibre's `icon-rotate` expects. */
    bearing: number
}

const EARTH_RADIUS_METRES = 6371000

function toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180
}

function toDegrees(radians: number): number {
    return (radians * 180) / Math.PI
}

/** Great-circle distance between two points, in metres. */
function haversineMetres(a: LonLat, b: LonLat): number {
    const lat1 = toRadians(a.lat)
    const lat2 = toRadians(b.lat)
    const dLat = toRadians(b.lat - a.lat)
    const dLon = toRadians(b.lon - a.lon)
    const sinDLat = Math.sin(dLat / 2)
    const sinDLon = Math.sin(dLon / 2)
    const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon
    const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
    return EARTH_RADIUS_METRES * c
}

/** Initial bearing travelling from `a` to `b`, degrees clockwise from north, 0-360. */
function bearingDegrees(a: LonLat, b: LonLat): number {
    const lat1 = toRadians(a.lat)
    const lat2 = toRadians(b.lat)
    const dLon = toRadians(b.lon - a.lon)
    const y = Math.sin(dLon) * Math.cos(lat2)
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
    const theta = Math.atan2(y, x)
    return (toDegrees(theta) + 360) % 360
}

function toLonLat(position: Position): LonLat {
    const lon = position[0]
    const lat = position[1]
    if (lon === undefined || lat === undefined) {
        throw new Error('Malformed pattern geometry coordinate: expected [lon, lat]')
    }
    return { lon, lat }
}

/**
 * Precomputes the cumulative distance in metres at each vertex of a pattern's polyline, so
 * `positionAt` can look up a point by distance without recomputing the walk every call. Call
 * this once per pattern at load, not per frame.
 */
export function buildPatternGeometry(feature: Feature<LineString, PatternGeometryProperties>): PatternGeometry {
    const coordinates = feature.geometry.coordinates.map(toLonLat)

    const cumulative: number[] = []
    let total = 0
    let previous: LonLat | undefined
    for (const point of coordinates) {
        if (previous) {
            total += haversineMetres(previous, point)
        }
        cumulative.push(total)
        previous = point
    }

    return {
        patternId: feature.properties.patternId,
        coordinates,
        cumulative,
        stopDistances: feature.properties.stopDistances,
    }
}

/** Largest index `i` in `[0, cumulative.length - 2]` with `cumulative[i] <= distance`. */
function segmentIndexFor(cumulative: number[], distance: number): number {
    let low = 0
    let high = cumulative.length - 2
    while (low < high) {
        const mid = (low + high + 1) >> 1
        const value = cumulative[mid]
        if (value !== undefined && value <= distance) {
            low = mid
        } else {
            high = mid - 1
        }
    }
    return low
}

/**
 * The point `metres` along `geometry`'s polyline, plus the bearing of travel at that point.
 * Clamps to the ends rather than extrapolating. Runs a binary search over the precomputed
 * cumulative distances, since this is called for every visible vehicle on every frame and
 * patterns average hundreds of vertices.
 */
export function positionAt(geometry: PatternGeometry, metres: number): PatternPosition {
    const { coordinates, cumulative } = geometry
    const lastIndex = cumulative.length - 1
    const total = lastIndex >= 0 ? cumulative[lastIndex] : undefined
    const first = coordinates[0]

    if (coordinates.length < 2 || total === undefined || first === undefined) {
        // A well-formed LineString always has at least two vertices; this only guards
        // against malformed input rather than a case the app is expected to hit.
        return { lon: first?.lon ?? 0, lat: first?.lat ?? 0, bearing: 0 }
    }

    const clamped = Math.min(Math.max(metres, 0), total)
    const i = segmentIndexFor(cumulative, clamped)
    const a = coordinates[i]
    const b = coordinates[i + 1]
    const startDistance = cumulative[i]
    const endDistance = cumulative[i + 1]

    if (a === undefined || b === undefined || startDistance === undefined || endDistance === undefined) {
        // Unreachable: segmentIndexFor bounds i to [0, coordinates.length - 2].
        return { lon: a?.lon ?? first.lon, lat: a?.lat ?? first.lat, bearing: 0 }
    }

    const segmentLength = endDistance - startDistance
    const t = segmentLength > 0 ? (clamped - startDistance) / segmentLength : 0

    return {
        lon: a.lon + (b.lon - a.lon) * t,
        lat: a.lat + (b.lat - a.lat) * t,
        bearing: bearingDegrees(a, b),
    }
}
