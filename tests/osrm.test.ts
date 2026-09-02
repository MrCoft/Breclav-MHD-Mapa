import { describe, expect, it, vi } from 'vitest'
import { buildOsrmUrl, routeWithOsrm } from '../scripts/osm/osrm'
import type { Position } from '../scripts/osm/match'

const stopCoords: Position[] = [
    [16.8, 48.7],
    [16.81, 48.72],
    [16.82, 48.74],
]

const okResponse = {
    code: 'Ok',
    routes: [
        {
            legs: [{ distance: 500 }, { distance: 750 }],
            geometry: {
                coordinates: [
                    [16.8, 48.7],
                    [16.805, 48.71],
                    [16.81, 48.72],
                    [16.82, 48.74],
                ],
            },
        },
    ],
    waypoints: [
        { distance: 1.2, location: [16.8, 48.7] },
        { distance: 3.4, location: [16.81, 48.72] },
        { distance: 0.5, location: [16.82, 48.74] },
    ],
}

function fakeFetch(body: unknown, status = 200): typeof fetch {
    return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })))
}

describe('buildOsrmUrl', () => {
    it('joins stop coordinates as lon,lat pairs on the driving profile with full overview geometry', () => {
        const url = buildOsrmUrl('https://router.project-osrm.org', stopCoords)
        expect(url).toBe(
            'https://router.project-osrm.org/route/v1/driving/16.8,48.7;16.81,48.72;16.82,48.74?overview=full&geometries=geojson',
        )
    })
})

describe('routeWithOsrm', () => {
    it('produces the route coordinates and cumulative leg distances as stopDistances', async () => {
        const result = await routeWithOsrm(stopCoords, { fetchFn: fakeFetch(okResponse), minIntervalMs: 0 })
        expect(result).not.toBeNull()
        expect(result!.coordinates).toEqual(okResponse.routes[0]!.geometry.coordinates)
        // Cumulative sum of leg distances [500, 750], starting at 0.
        expect(result!.stopDistances).toEqual([0, 500, 1250])
    })

    it('rejects a response whose waypoint snap distance exceeds 250 m', async () => {
        const badResponse = {
            ...okResponse,
            waypoints: [
                { distance: 1, location: [0, 0] },
                { distance: 260, location: [0, 0] },
                { distance: 1, location: [0, 0] },
            ],
        }
        const result = await routeWithOsrm(stopCoords, { fetchFn: fakeFetch(badResponse), minIntervalMs: 0 })
        expect(result).toBeNull()
    })

    it('accepts a response right at the snap-distance boundary', async () => {
        const boundaryResponse = {
            ...okResponse,
            waypoints: [
                { distance: 250, location: [0, 0] },
                { distance: 1, location: [0, 0] },
                { distance: 1, location: [0, 0] },
            ],
        }
        const result = await routeWithOsrm(stopCoords, { fetchFn: fakeFetch(boundaryResponse), minIntervalMs: 0 })
        expect(result).not.toBeNull()
    })

    it('rejects a non-Ok code', async () => {
        const result = await routeWithOsrm(stopCoords, {
            fetchFn: fakeFetch({ code: 'NoRoute', routes: [], waypoints: [] }),
            minIntervalMs: 0,
        })
        expect(result).toBeNull()
    })

    it('sends a User-Agent header identifying the project', async () => {
        const mockFetch = fakeFetch(okResponse)
        await routeWithOsrm(stopCoords, { fetchFn: mockFetch, minIntervalMs: 0 })

        expect(mockFetch).toHaveBeenCalledOnce()
        const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
        const init = callArgs[1]
        const headers = init.headers as Record<string, string>
        expect(headers['User-Agent']).toBeTruthy()
        expect(headers['User-Agent']).toMatch(/Breclav-MHD-Mapa/)
    })
})
