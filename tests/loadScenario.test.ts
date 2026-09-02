import { describe, expect, it, vi } from 'vitest'
import { listScenarios, loadScenario } from '../src/data/loadScenario'
import { tinyNetwork } from './fixtures/tinyNetwork'

const meta = {
    feedDate: '2026-08-28',
    generatedAt: '2026-09-02T00:00:00Z',
    converterVersion: '1.0.0',
    geometrySources: { osm: 1, straight: 0, override: 0 },
}
const geometry = { type: 'FeatureCollection', features: [] }

function fakeFetch(bodies: Record<string, unknown>): typeof fetch {
    return vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        const key = Object.keys(bodies).find((name) => url.endsWith(name))
        if (!key) {
            return new Response('not found', { status: 404 })
        }
        return new Response(JSON.stringify(bodies[key]), { status: 200 })
    })
}

describe('loadScenario', () => {
    it('loads, validates, and indexes a scenario', async () => {
        const scenario = await loadScenario(
            'current',
            fakeFetch({ 'network.json': tinyNetwork, 'meta.json': meta, 'geometry.geojson': geometry }),
        )

        expect(scenario.id).toBe('current')
        expect(scenario.meta.feedDate).toBe('2026-08-28')
        expect(scenario.index.lines.get('563')?.name).toBe('563')
        expect(scenario.index.patternsByStop.get('a')).toHaveLength(1)
    })

    it('names the missing file in the error', async () => {
        await expect(loadScenario('current', fakeFetch({ 'meta.json': meta }))).rejects.toThrow(/network\.json/)
    })

    it('rejects a scenario that fails validation', async () => {
        const broken = structuredClone(tinyNetwork)
        broken.patterns[0]!.stops[0] = 'ghost'
        await expect(
            loadScenario(
                'current',
                fakeFetch({ 'network.json': broken, 'meta.json': meta, 'geometry.geojson': geometry }),
            ),
        ).rejects.toThrow(/ghost/)
    })
})

describe('listScenarios', () => {
    it('fetches and returns the scenario list', async () => {
        const scenarios = [
            { id: 'current', label: 'Současný stav' },
            { id: 'proposed', label: 'Návrh 2026' },
        ]
        await expect(listScenarios(fakeFetch({ 'scenarios.json': scenarios }))).resolves.toEqual(scenarios)
    })

    it('names the missing file in the error', async () => {
        await expect(listScenarios(fakeFetch({}))).rejects.toThrow(/scenarios\.json/)
    })
})
