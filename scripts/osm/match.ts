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
 * Recomputes where each stop lands on a *simplified* version of a line already trusted to be
 * the correct, ordered path — for stop distances that must survive `simplifyIndices` shrinking
 * the line out from under them.
 *
 * The obvious approach is `measureAlong(simplifiedCoordinates, stopCoords)`: a fresh whole-line
 * nearest-point search, same as everywhere else in this file. It is wrong here specifically. A
 * route that revisits the same ground — a terminus loop, an out-and-back leg, two carriageways
 * a few metres apart — can, on a line reduced to a few dozen vertices, put the geometrically
 * nearest point on an entirely different pass over that ground than the one the stop actually
 * belongs to; the denser the line, the more clearly the true match wins, and simplification
 * removes exactly that margin. `originalStopDistances` — the tier's already-correct distances
 * against the dense pre-simplification line, wherever those came from (a relation's own nearest
 * point, or OSRM's real routed leg lengths) — is trusted precisely because it was measured with
 * that margin intact.
 *
 * So each original distance is used only to place a search *window*: the pair of simplified
 * vertices that `simplifyIndices` kept on either side of wherever that distance falls among the
 * original vertices. Douglas-Peucker guarantees every point of the original path between two
 * kept vertices lies within `toleranceMetres` of the straight segment joining them, so the
 * stop's true position is guaranteed to be near that specific segment — and nowhere near a
 * distant, unrelated one. The projection performed inside the window is a genuine fresh
 * `nearestPointOnLine`, not the old value scaled or reused; the window only rules out a distant
 * false match, it never supplies the answer itself.
 */
export function remeasureSimplified(args: {
    originalCoordinates: Position[]
    originalStopDistances: number[]
    simplifiedCoordinates: Position[]
    keptIndices: number[]
    stopCoords: Position[]
}): { along: number[]; maxOffMetres: number; maxClampMetres: number } {
    const { originalCoordinates, originalStopDistances, simplifiedCoordinates, keptIndices, stopCoords } = args
    const origCumulative = cumulativeDistances(originalCoordinates)
    const keptCumulative = keptIndices.map((i) => origCumulative[i]!)
    const newCumulative = cumulativeDistances(simplifiedCoordinates)
    const lastKept = keptCumulative.length - 1

    const along: number[] = []
    let maxOffMetres = 0
    // How far the *unclamped* projection ever fell below the running previous stop — see the
    // clamp comment below. A correct window search should never need this; a non-trivial value
    // means the clamp silently absorbed a real backward jump, and the caller must treat that as
    // a failure rather than accept the floored result quietly.
    let maxClampMetres = 0
    let previous = 0
    let lo = 0

    for (let i = 0; i < stopCoords.length; i += 1) {
        const target = stopCoords[i]!
        const anchor = originalStopDistances[i] ?? 0
        while (lo < lastKept - 1 && keptCumulative[lo + 1]! < anchor) {
            lo += 1
        }

        // One extra kept vertex of padding on each side, as slack for floating-point noise
        // between the anchor's own measurement and this file's distance conventions — not
        // enough slack to reach a different pass over the same ground (see the doc comment).
        const windowStart = Math.max(0, lo - 1)
        const windowEnd = Math.min(simplifiedCoordinates.length - 1, lo + 2)
        const window = simplifiedCoordinates.slice(windowStart, windowEnd + 1)

        let atMetres: number
        let offMetres: number
        if (window.length < 2) {
            const only = simplifiedCoordinates[windowStart] ?? target
            atMetres = newCumulative[windowStart] ?? 0
            offMetres = distance(point(target), point(only), { units: 'meters' })
        } else {
            const snapped = nearestPointOnLine(lineString(window), point(target), { units: 'meters' })
            atMetres = newCumulative[windowStart]! + snapped.properties.totalDistance
            offMetres = snapped.properties.pointDistance
        }

        // A safety floor, not a correction: two stops can legitimately share a short window,
        // where the raw projections could otherwise tie or drift a hair backwards. Recorded
        // *before* flooring, not discarded, so a genuine backward jump — the exact bug this
        // function exists to prevent — is visible to the caller instead of silently absorbed.
        maxClampMetres = Math.max(maxClampMetres, previous - atMetres)
        const clamped = Math.max(atMetres, previous)
        along.push(clamped)
        previous = clamped
        maxOffMetres = Math.max(maxOffMetres, offMetres)
    }

    return { along, maxOffMetres, maxClampMetres }
}

/**
 * The two checks that decide whether stops genuinely lie on, and traverse, `coords`: none
 * projects further than `maxSnapMetres` off it, and their projections strictly increase (so the
 * line runs the same way the stops are visited, rather than backwards or through an unrelated
 * pass of a self-revisiting route). Shared by `trimToStops` (the relation tier) and
 * `matchPatternGeometry`'s manual-override tier (finding I11) — a hand-authored override is
 * exactly the kind of geometry `remeasureSimplified`'s own doc comment warns an unchecked
 * `measureAlong` can silently mis-snap on a loop or an out-and-back leg, which is precisely what
 * an override is meant to be the fix for.
 */
function isMonotonicAndSnapped(along: number[], maxOffMetres: number, maxSnapMetres: number): boolean {
    if (maxOffMetres > maxSnapMetres) {
        return false
    }
    for (let i = 1; i < along.length; i += 1) {
        if (along[i]! < along[i - 1]!) {
            return false
        }
    }
    return true
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

        if (!isMonotonicAndSnapped(along, maxOffMetres, maxSnapMetres)) {
            return null
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
        // Same checks the relation tier enforces (see `isMonotonicAndSnapped`'s doc comment) —
        // an override used to skip both and call `measureAlong` on the whole line unconditionally
        // (finding I11). Retried reversed for the same reason `trimToStops` retries reversed: a
        // hand-drawn override may run start-to-end opposite the pattern's own stop order.
        const attempt = (coords: Position[]): { coords: Position[]; along: number[] } | null => {
            const { along, maxOffMetres } = measureAlong(coords, stopCoords)
            return isMonotonicAndSnapped(along, maxOffMetres, maxSnapMetres) ? { coords, along } : null
        }
        const fit = attempt(override) ?? attempt([...override].reverse())
        if (!fit) {
            throw new Error(
                `matchPatternGeometry: override for pattern ${pattern.id} fails the relation tier's own checks ` +
                    `(stops within ${maxSnapMetres}m of the line, projecting onto it in increasing order) in ` +
                    'either direction. An override exists to fix exactly the self-revisiting-route case an ' +
                    'unchecked nearest-point search gets wrong, so a broken override fails the build loudly ' +
                    'rather than silently falling through to the router or a straight line.',
            )
        }
        const origin = fit.along[0]!
        return {
            coordinates: fit.coords,
            stopDistances: fit.along.map((a) => Math.max(0, a - origin)),
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
