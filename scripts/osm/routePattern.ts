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

/**
 * Tier-3 geometry: routes a pattern's stops through OSRM's road network for buses, or
 * a Dijkstra shortest path over the rail graph for trains. Caches per pattern under
 * `data/cache/routing/<patternId>.json`, including a rejection, so a repeat build
 * never needs the network to reach the same fallback decision.
 */
export async function routePattern(
    pattern: Pattern,
    stopCoords: Position[],
    deps: RoutePatternDeps,
): Promise<TrimmedLine | null> {
    const cacheDir = deps.cacheDir ?? 'data/cache/routing'
    const cachePath = join(cacheDir, `${pattern.id}.json`)

    if (!deps.refresh && existsSync(cachePath)) {
        const cached = JSON.parse(readFileSync(cachePath, 'utf8')) as CachedRoute
        return isCachedFailure(cached) ? null : cached
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
    const toCache: CachedRoute = result ?? { failed: true }
    writeFileSync(cachePath, `${JSON.stringify(toCache)}\n`, 'utf8')
    return result
}
