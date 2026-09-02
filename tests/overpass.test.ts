import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { buildQuery, fetchRoutes } from '../scripts/osm/overpass'
import { loadScope } from '../scripts/gtfs/read'

const scope = loadScope()

describe('buildQuery', () => {
    const query = buildQuery(scope)

    it('filters to route relations in the configured network', () => {
        expect(query).toContain('"type"="route"')
        expect(query).toContain('"network"~"IDS JMK"')
    })

    it('bounds the query by the configured bbox', () => {
        expect(query).toContain('48.55,15.95,49.35,17.65')
    })

    it('requests way geometry, not just relation membership', () => {
        expect(query).toContain('out body')
        expect(query).toContain('>;')
    })

    it('matches both network and network:short tags in a union', () => {
        // Both tag filters should be present
        expect(query).toContain('"network"~"IDS JMK"')
        expect(query).toContain('"network:short"~"IDS JMK"')

        // Union syntax should be present
        expect(query).toContain('(')
        expect(query).toContain(');')

        // Both clauses should have the type constraint
        expect(query).toMatch(/relation\["type"="route"\].*"network"~/)
        expect(query).toMatch(/relation\["type"="route"\].*"network:short"~/)

        // Bbox should appear at least twice (once per clause)
        const bboxString = '48.55,15.95,49.35,17.65'
        const bboxMatches = (query.match(new RegExp(bboxString, 'g')) || []).length
        expect(bboxMatches).toBeGreaterThanOrEqual(2)
    })
})

describe('fetchRoutes', () => {
    it('reads the cache without hitting the network', async () => {
        const cacheDir = mkdtempSync(join(tmpdir(), 'osm-'))
        const cached = { version: 0.6, generator: 'test', elements: [] }
        writeFileSync(join(cacheDir, 'routes.json'), JSON.stringify(cached), 'utf8')

        const result = await fetchRoutes(scope, { cacheDir })
        expect(result.elements).toEqual([])
    })

    it('leaves the cache file untouched when it already exists', async () => {
        const cacheDir = mkdtempSync(join(tmpdir(), 'osm-'))
        const path = join(cacheDir, 'routes.json')
        writeFileSync(path, JSON.stringify({ version: 0.6, generator: 'x', elements: [] }), 'utf8')
        const before = readFileSync(path, 'utf8')

        await fetchRoutes(scope, { cacheDir })
        expect(readFileSync(path, 'utf8')).toBe(before)
    })

    it('sends a User-Agent header in the request', async () => {
        const cacheDir = mkdtempSync(join(tmpdir(), 'osm-'))

        const mockResponse = new Response(JSON.stringify({ version: 0.6, generator: 'test', elements: [] }), {
            status: 200,
            statusText: 'OK',
        })

        const mockFetch = vi.fn().mockResolvedValue(mockResponse)
        vi.stubGlobal('fetch', mockFetch)

        try {
            await fetchRoutes(scope, { cacheDir, refresh: true })

            expect(mockFetch).toHaveBeenCalledOnce()

            const callArgs = mockFetch.mock.calls[0]
            if (!callArgs) {
                throw new Error('Expected fetch to be called')
            }

            const init = callArgs[1] as Record<string, any>

            expect(init.headers).toBeDefined()
            const headers = init.headers as Record<string, string>
            expect(headers['User-Agent']).toBeTruthy()
            expect(headers['User-Agent']).toMatch(/Breclav-MHD-Mapa/)
        } finally {
            vi.unstubAllGlobals()
        }
    })
})
