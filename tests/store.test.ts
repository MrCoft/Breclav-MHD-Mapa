import { describe, expect, it } from 'vitest'
import { buildIndex } from '../src/data/buildIndex'
import { appStore, selectLine, selectStop, setScenario } from '../src/state/store'
import { tinyNetwork } from './fixtures/tinyNetwork'
import type { Scenario } from '../src/data/loadScenario'
import type { Network } from '../src/types/network'

const meta = {
    feedDate: '2026-08-28',
    generatedAt: '2026-09-02T00:00:00Z',
    converterVersion: '1.0.0',
    geometrySources: { osm: 1, routed: 0, straight: 0, override: 0 },
}

function scenarioFor(id: string, network: Network): Scenario {
    return { id, index: buildIndex(network), meta, geometry: { type: 'FeatureCollection', features: [] } }
}

// tinyNetwork's line '563' and stop 'a' exist in `withLineAndStop`. `withoutEither` is a stand-in
// for switching to a scenario that dropped both — e.g. line 564 exists in "Současný stav" but not
// "Návrh 2026" — with no lines, patterns or trips of its own and stop 'a' removed.
const withLineAndStop = scenarioFor('current', tinyNetwork)
const withoutEither = scenarioFor('proposed', {
    ...tinyNetwork,
    stops: tinyNetwork.stops.filter((stop) => stop.id !== 'a'),
    lines: [],
    patterns: [],
    trips: [],
})

describe('setScenario', () => {
    it('keeps a selected line and stop that still exist in the new scenario', () => {
        setScenario(withLineAndStop)
        selectLine('563')
        selectStop('a')

        setScenario(withLineAndStop)

        expect(appStore.state.selectedLine).toBe('563')
        expect(appStore.state.selectedStop).toBe('a')
    })

    it('clears a selected line absent from the new scenario rather than leaving it dangling', () => {
        setScenario(withLineAndStop)
        selectLine('563')

        setScenario(withoutEither)

        expect(appStore.state.selectedLine).toBeNull()
    })

    it('clears a selected stop absent from the new scenario rather than leaving it dangling', () => {
        setScenario(withLineAndStop)
        selectStop('a')

        setScenario(withoutEither)

        expect(appStore.state.selectedStop).toBeNull()
    })

    it('leaves no selection as no selection', () => {
        setScenario(withLineAndStop)
        selectLine(null)
        selectStop(null)

        setScenario(withoutEither)

        expect(appStore.state.selectedLine).toBeNull()
        expect(appStore.state.selectedStop).toBeNull()
    })

    it('also clears the error, same as before', () => {
        appStore.setState((state) => ({ ...state, error: 'stale' }))

        setScenario(withLineAndStop)

        expect(appStore.state.error).toBeNull()
    })
})
