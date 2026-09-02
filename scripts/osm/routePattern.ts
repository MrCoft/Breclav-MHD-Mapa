import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { routeWithOsrm } from './osrm'
import { routeOnRailGraph } from './railGraph'
import type { RailGraph } from './railGraph'
import type { Position, TrimmedLine } from './match'
import type { Mode, Pattern } from '../../src/types/network'

export interface RoutePatternDeps {
    mode: Mode
    /** Required when `mode` is 'rail'. Built once per build and shared across patterns. */
    railGraph?: RailGraph
    cacheDir?: string
    refresh?: boolean
    /** Injected for tests; defaults to the global fetch. Only used for bus (OSRM) routing. */
    fetchFn?: typeof fetch
    osrmBaseUrl?: string
    minIntervalMs?: number
}

interface CachedFailure {
    failed: true
}

type CachedRoute = TrimmedLine | CachedFailure

function isCachedFailure(value: CachedRoute): value is CachedFailure {
    return 'failed' in value
}

/** Cache file shape: the routed (or failed) result alongside a hash of the stop coordinates it
 *  was computed for — see `routePattern`'s doc comment for why. */
interface CacheEntry {
    stopCoordsHash: string
    route: CachedRoute
}

/**
 * `convert.ts` builds `patternId` as `${line}-${direction}-${n}`, where `n` is positional over
 * sorted group keys — so adding or dropping a stop-sequence variant in a feed rebuild renumbers
 * every later pattern on that line. A hash of the exact stop coordinates routed catches that: a
 * cache entry whose hash doesn't match the pattern asking for it is treated as a miss rather than
 * silently handed back another pattern's route (finding I5). Rounded to 6 decimal places (~11cm)
 * before hashing so IEEE-754 float formatting noise across runs can't itself cause a false miss.
 */
function hashStopCoords(stopCoords: Position[]): string {
    const rounded = stopCoords.map(([lon, lat]) => [Number(lon.toFixed(6)), Number(lat.toFixed(6))])
    return createHash('sha1').update(JSON.stringify(rounded)).digest('hex')
}

/**
 * Tier-3 geometry: routes a pattern's stops through OSRM's road network for buses, or
 * a Dijkstra shortest path over the rail graph for trains. Caches per pattern under
 * `data/cache/routing/<patternId>.json`, including a rejection, so a repeat build
 * never needs the network to reach the same fallback decision. Guarded by a hash of the stop
 * coordinates the cached route was computed for (see `hashStopCoords`), so a pattern id that gets
 * reused for a different route across a feed rebuild is treated as a cache miss rather than
 * silently handed the old route.
 */
export async function routePattern(
    pattern: Pattern,
    stopCoords: Position[],
    deps: RoutePatternDeps,
): Promise<TrimmedLine | null> {
    const cacheDir = deps.cacheDir ?? 'data/cache/routing'
    const cachePath = join(cacheDir, `${pattern.id}.json`)
    const stopCoordsHash = hashStopCoords(stopCoords)

    if (!deps.refresh && existsSync(cachePath)) {
        const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as CacheEntry
        if (cached.stopCoordsHash === stopCoordsHash) {
            return isCachedFailure(cached.route) ? null : cached.route
        }
        // Falls through to re-route: either a pre-hash cache file, or a genuine stop-coordinate
        // mismatch (this pattern id now names a different route than whatever was cached).
    }

    let result: TrimmedLine | null
    if (deps.mode === 'rail') {
        if (!deps.railGraph) {
            throw new Error(`routePattern: rail graph is required to route pattern ${pattern.id}`)
        }
        result = routeOnRailGraph(deps.railGraph, stopCoords)
    } else {
        result = await routeWithOsrm(stopCoords, {
            fetchFn: deps.fetchFn,
            baseUrl: deps.osrmBaseUrl,
            minIntervalMs: deps.minIntervalMs,
        })
    }

    mkdirSync(cacheDir, { recursive: true })
    const toCache: CacheEntry = { stopCoordsHash, route: result ?? { failed: true } }
    writeFileSync(cachePath, `${JSON.stringify(toCache)}\n`, 'utf8')
    return result
}
