import type { Position, TrimmedLine } from './match'

export interface OsrmWaypoint {
    distance: number
    location: Position
}

export interface OsrmLeg {
    distance: number
}

export interface OsrmRoute {
    legs: OsrmLeg[]
    geometry: { coordinates: Position[] }
}

export interface OsrmResponse {
    code: string
    routes: OsrmRoute[]
    waypoints: OsrmWaypoint[]
}

const DEFAULT_BASE_URL = 'https://router.project-osrm.org'
const USER_AGENT = 'Breclav-MHD-Mapa/1.0 (+https://github.com/MrCoft/Breclav-MHD-Mapa)'

/** One request routes a whole pattern through all its stops as via points. */
export function buildOsrmUrl(baseUrl: string, stopCoords: Position[]): string {
    const coords = stopCoords.map(([lon, lat]) => `${lon},${lat}`).join(';')
    return `${baseUrl}/route/v1/driving/${coords}?overview=full&geometries=geojson`
}

// router.project-osrm.org is a free community server: at most one request per second,
// serialised, no matter which pattern is asking. This tracks the last real request across
// calls in this process so a whole build's worth of patterns stays within that budget.
let lastRequestAt = 0

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
}

async function throttle(minIntervalMs: number): Promise<void> {
    if (minIntervalMs <= 0) {
        return
    }
    const wait = lastRequestAt + minIntervalMs - Date.now()
    if (wait > 0) {
        await sleep(wait)
    }
    lastRequestAt = Date.now()
}

/**
 * Routes a pattern's stops through OSRM's road network in a single request.
 *
 * Returns null when OSRM can't produce a usable route for this pattern: a non-`Ok`
 * response, or any stop snapped more than `maxSnapMetres` from the matched road —
 * that means OSRM matched the wrong road, and a straight line is more honest than a
 * confidently wrong one. Both are ordinary tier-3 misses, not errors; an HTTP failure
 * still throws, since that is a reason to stop and look rather than fall through.
 */
export async function routeWithOsrm(
    stopCoords: Position[],
    opts: {
        baseUrl?: string
        fetchFn?: typeof fetch
        userAgent?: string
        maxSnapMetres?: number
        minIntervalMs?: number
    } = {},
): Promise<TrimmedLine | null> {
    const {
        baseUrl = DEFAULT_BASE_URL,
        fetchFn = fetch,
        userAgent = USER_AGENT,
        maxSnapMetres = 250,
        minIntervalMs = 1000,
    } = opts

    await throttle(minIntervalMs)

    const url = buildOsrmUrl(baseUrl, stopCoords)
    const res = await fetchFn(url, {
        headers: { 'User-Agent': userAgent },
    })
    if (!res.ok) {
        throw new Error(`OSRM failed: ${res.status} ${res.statusText}`)
    }

    const body = (await res.json()) as OsrmResponse
    if (body.code !== 'Ok' || body.routes.length === 0) {
        return null
    }
    if (body.waypoints.some((w) => w.distance > maxSnapMetres)) {
        return null
    }

    const route = body.routes[0]!
    // route.legs[i].distance is the metres between waypoint i and i+1, so the cumulative
    // sum, starting at 0, is exactly the stop distances array — no re-projection needed.
    const stopDistances: number[] = [0]
    for (const leg of route.legs) {
        stopDistances.push(stopDistances[stopDistances.length - 1]! + leg.distance)
    }

    return { coordinates: route.geometry.coordinates, stopDistances }
}
