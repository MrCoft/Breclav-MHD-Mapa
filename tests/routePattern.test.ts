import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { routePattern } from '../scripts/osm/routePattern'
import type { RailGraph } from '../scripts/osm/railGraph'
import type { Position } from '../scripts/osm/match'
import type { Pattern } from '../src/types/network'

const busPattern: Pattern = {
    id: '572-0-1',
    line: '572',
    direction: 0,
    headsign: 'Test',
    stops: ['a', 'b'],
    offsets: [0, 5],
}

const railPattern: Pattern = {
    id: 'R13-0-1',
    line: 'R13',
    direction: 0,
    headsign: 'Test',
    stops: ['a', 'b'],
    offsets: [0, 5],
}

const stopCoords: Position[] = [
    [16.8, 48.7],
    [16.83, 48.7],
]

const okOsrmResponse = {
    code: 'Ok',
    routes: [
        {
            legs: [{ distance: 1000 }],
            geometry: {
                coordinates: [
                    [16.8, 48.7],
                    [16.83, 48.7],
                ],
            },
        },
    ],
    waypoints: [
        { distance: 1, location: [16.8, 48.7] },
        { distance: 1, location: [16.83, 48.7] },
    ],
}

function fakeFetch(body: unknown): typeof fetch {
    return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })))
}

function diamondGraph(): RailGraph {
    return {
        nodes: new Map<number, Position>([
            [1, [16.8, 48.7]],
            [2, [16.83, 48.7]],
        ]),
        adjacency: new Map([
            [1, [{ to: 2, weight: 3000 }]],
            [2, [{ to: 1, weight: 3000 }]],
        ]),
    }
}

describe('routePattern', () => {
    it('routes buses via OSRM and caches the result under the pattern id', async () => {
        const cacheDir = mkdtempSync(join(tmpdir(), 'routing-'))
        const fetchFn = fakeFetch(okOsrmResponse)

        const result = await routePattern(busPattern, stopCoords, { mode: 'bus', cacheDir, fetchFn, minIntervalMs: 0 })

        expect(result).not.toBeNull()
        expect(result!.stopDistances).toEqual([0, 1000])

        const cached = JSON.parse(readFileSync(join(cacheDir, `${busPattern.id}.json`), 'utf8')) as {
            stopCoordsHash: string
            route: unknown
        }
        expect(cached.route).toEqual(result)
        expect(cached.stopCoordsHash).toEqual(expect.any(String))
        expect(cached.stopCoordsHash.length).toBeGreaterThan(0)
    })

    it('reads a cached pattern without calling fetch again', async () => {
        const cacheDir = mkdtempSync(join(tmpdir(), 'routing-'))
        const fetchFn = fakeFetch(okOsrmResponse)

        await routePattern(busPattern, stopCoords, { mode: 'bus', cacheDir, fetchFn, minIntervalMs: 0 })
        expect(fetchFn).toHaveBeenCalledOnce()

        const second = await routePattern(busPattern, stopCoords, {
            mode: 'bus',
            cacheDir,
            fetchFn,
            minIntervalMs: 0,
        })
        expect(fetchFn).toHaveBeenCalledOnce()
        expect(second).not.toBeNull()
        expect(second!.stopDistances).toEqual([0, 1000])
    })

    it('re-requests a cached pattern when refresh is set', async () => {
        const cacheDir = mkdtempSync(join(tmpdir(), 'routing-'))
        const fetchFn = fakeFetch(okOsrmResponse)

        await routePattern(busPattern, stopCoords, { mode: 'bus', cacheDir, fetchFn, minIntervalMs: 0 })
        await routePattern(busPattern, stopCoords, {
            mode: 'bus',
            cacheDir,
            fetchFn,
            minIntervalMs: 0,
            refresh: true,
        })

        expect(fetchFn).toHaveBeenCalledTimes(2)
    })

    it('caches a rejection so a repeat build does not need the network to reach the same fallback', async () => {
        const cacheDir = mkdtempSync(join(tmpdir(), 'routing-'))
        const fetchFn = fakeFetch({ code: 'NoRoute', routes: [], waypoints: [] })

        const first = await routePattern(busPattern, stopCoords, {
            mode: 'bus',
            cacheDir,
            fetchFn,
            minIntervalMs: 0,
        })
        expect(first).toBeNull()
        expect(fetchFn).toHaveBeenCalledOnce()

        const second = await routePattern(busPattern, stopCoords, {
            mode: 'bus',
            cacheDir,
            fetchFn,
            minIntervalMs: 0,
        })
        expect(second).toBeNull()
        expect(fetchFn).toHaveBeenCalledOnce()
    })

    it('re-routes when the same pattern id now names a different route (finding I5)', async () => {
        // `convert.ts` numbers pattern ids positionally, so a feed rebuild can reuse a pattern id
        // for a genuinely different set of stops. A cache keyed only by pattern id would silently
        // hand back the old route; this asserts it does not.
        const cacheDir = mkdtempSync(join(tmpdir(), 'routing-'))
        const fetchFn = fakeFetch(okOsrmResponse)

        await routePattern(busPattern, stopCoords, { mode: 'bus', cacheDir, fetchFn, minIntervalMs: 0 })
        expect(fetchFn).toHaveBeenCalledOnce()

        const movedStopCoords: Position[] = [
            [16.9, 48.75],
            [16.93, 48.75],
        ]
        await routePattern(busPattern, movedStopCoords, { mode: 'bus', cacheDir, fetchFn, minIntervalMs: 0 })
        expect(fetchFn).toHaveBeenCalledTimes(2)
    })

    it('reads a cache file written before this hash existed as a miss, not a crash', async () => {
        const cacheDir = mkdtempSync(join(tmpdir(), 'routing-'))
        writeFileSync(join(cacheDir, `${busPattern.id}.json`), `${JSON.stringify(okOsrmResponse.routes[0])}\n`, 'utf8')
        const fetchFn = fakeFetch(okOsrmResponse)

        const result = await routePattern(busPattern, stopCoords, { mode: 'bus', cacheDir, fetchFn, minIntervalMs: 0 })

        expect(fetchFn).toHaveBeenCalledOnce()
        expect(result).not.toBeNull()
    })

    it('routes rail patterns over the injected rail graph, never touching OSRM', async () => {
        const cacheDir = mkdtempSync(join(tmpdir(), 'routing-'))
        const fetchFn = vi.fn()

        const result = await routePattern(railPattern, stopCoords, {
            mode: 'rail',
            cacheDir,
            railGraph: diamondGraph(),
            fetchFn,
        })

        expect(fetchFn).not.toHaveBeenCalled()
        expect(result).not.toBeNull()
        expect(result!.stopDistances).toEqual([0, 3000])
    })
})
