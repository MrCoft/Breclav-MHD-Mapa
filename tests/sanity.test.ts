import { describe, expect, it } from 'vitest'
import { assertSane } from '../scripts/build-network'
import { loadScope } from '../scripts/gtfs/read'
import { tinyNetwork } from './fixtures/tinyNetwork'
import type { Network } from '../src/types/network'

const scope = { ...loadScope(), expectedRoutes: { min: 1, max: 5 } }

describe('assertSane', () => {
    it('accepts a plausible network', () => {
        expect(() => assertSane(tinyNetwork, scope)).not.toThrow()
    })

    it('rejects a route count outside the expected band', () => {
        expect(() => assertSane(tinyNetwork, { ...scope, expectedRoutes: { min: 10, max: 20 } })).toThrow(/lines/i)
    })

    it('rejects a network with no trips', () => {
        const empty: Network = { ...structuredClone(tinyNetwork), trips: [] }
        expect(() => assertSane(empty, scope)).toThrow(/trips/i)
    })

    it('rejects a stop that no pattern serves', () => {
        const orphan: Network = structuredClone(tinyNetwork)
        orphan.stops.push({ id: 'z', name: 'Nikde', lat: 48, lon: 16 })
        expect(() => assertSane(orphan, scope)).toThrow(/z/)
    })
})
