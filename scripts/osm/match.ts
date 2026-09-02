import distance from '@turf/distance'
import { lineString, point } from '@turf/helpers'
import lineSlice from '@turf/line-slice'
import nearestPointOnLine from '@turf/nearest-point-on-line'
import type { Pattern, Stop } from '../../src/types/network'

export type GeometrySource = 'override' | 'osm' | 'routed' | 'straight'
export type Position = [number, number]

export interface RelationLine {
    ref: string
    coordinates: Position[]
}

export interface TrimmedLine {
    coordinates: Position[]
    /** Metres along `coordinates` at each pattern stop. Same length and order as the stops. */
    stopDistances: number[]
}

/**
 * Tier-3 geometry lookup, injected so this file stays free of network/graph concerns.
 * Called only when no relation matches the pattern; returns null when the router itself
 * can't produce a usable route, which falls through to the straight-line tier.
 */
export type PatternRouter = (pattern: Pattern, stopCoords: Position[]) => Promise<TrimmedLine | null>

export function straightLine(pattern: Pattern, stops: Map<string, Stop>): Position[] {
    return pattern.stops
        .map((id) => stops.get(id))
        .filter((s): s is Stop => s !== undefined)
        .map((s) => [s.lon, s.lat] as Position)
}

/** Metres from the start of the polyline to each of its own vertices. */
export function cumulativeDistances(coords: Position[]): number[] {
    const out: number[] = [0]
    for (let i = 1; i < coords.length; i += 1) {
        out.push(out[i - 1]! + distance(point(coords[i - 1]!), point(coords[i]!), { units: 'meters' }))
    }
    return out
}

/** Where each stop projects onto `line`, and how far the worst one sits off it. */
export function measureAlong(line: Position[], stopCoords: Position[]): { along: number[]; maxOffMetres: number } {
    const feature = lineString(line)
    const along: number[] = []
    let maxOffMetres = 0
    for (const c of stopCoords) {
        const snapped = nearestPointOnLine(feature, point(c), { units: 'meters' })
        along.push(snapped.properties.location)
        maxOffMetres = Math.max(maxOffMetres, distance(point(c), snapped, { units: 'meters' }))
    }
    return { along, maxOffMetres }
}

/**
 * Cuts `line` down to the span the stops actually traverse.
 *
 * Returns null when the stops are too far from the line to be on it, or when
 * their positions along it are not increasing — which means this relation runs
 * the other way, or is the wrong variant entirely. The line is retried reversed
 * before giving up, since OSM relations are commonly drawn in one direction only.
 */
export function trimToStops(line: Position[], stopCoords: Position[], maxSnapMetres: number): TrimmedLine | null {
    if (line.length < 2 || stopCoords.length < 2) {
        return null
    }

    const attempt = (coords: Position[]): TrimmedLine | null => {
        const { along, maxOffMetres } = measureAlong(coords, stopCoords)

        if (maxOffMetres > maxSnapMetres) {
            return null
        }
        for (let i = 1; i < along.length; i += 1) {
            if (along[i]! < along[i - 1]!) {
                return null
            }
        }

        const feature = lineString(coords)
        const sliced = lineSlice(point(stopCoords[0]!), point(stopCoords[stopCoords.length - 1]!), feature)

        // The slice starts at the first stop, so distances rebase onto it. The slice is a
        // sub-path of the same line, so subtracting the origin is exact rather than an estimate.
        const origin = along[0]!
        return {
            coordinates: sliced.geometry.coordinates as Position[],
            stopDistances: along.map((a) => Math.max(0, a - origin)),
        }
    }

    return attempt(line) ?? attempt([...line].reverse())
}

export async function matchPatternGeometry(args: {
    pattern: Pattern
    stops: Map<string, Stop>
    relations: RelationLine[]
    override?: Position[]
    maxSnapMetres?: number
    /** Tier 3: tried after the relation tier misses, before falling back to a straight line. */
    router?: PatternRouter
}): Promise<{ coordinates: Position[]; stopDistances: number[]; source: GeometrySource }> {
    const { pattern, stops, relations, override, maxSnapMetres = 250, router } = args
    const stopCoords = straightLine(pattern, stops)

    if (override && override.length >= 2) {
        const { along } = measureAlong(override, stopCoords)
        const origin = along[0]!
        return {
            coordinates: override,
            stopDistances: along.map((a) => Math.max(0, a - origin)),
            source: 'override',
        }
    }

    const candidates = relations
        .filter((r) => r.ref === pattern.line)
        .map((r) => trimToStops(r.coordinates, stopCoords, maxSnapMetres))
        .filter((c): c is TrimmedLine => c !== null)

    if (candidates.length > 0) {
        // Several relation variants can fit. The longest surviving trim is the one
        // that actually reaches every stop rather than stopping short.
        const best = candidates.sort((a, b) => b.coordinates.length - a.coordinates.length)[0]!
        return { ...best, source: 'osm' }
    }

    // The relation is the published route and knows about bus-only links and one-way loops
    // a road router would smooth over, so it stays first among the automatic tiers. Only a
    // pattern no relation covers reaches the router.
    if (router) {
        const routed = await router(pattern, stopCoords)
        if (routed) {
            return { ...routed, source: 'routed' }
        }
    }

    return { coordinates: stopCoords, stopDistances: cumulativeDistances(stopCoords), source: 'straight' }
}
