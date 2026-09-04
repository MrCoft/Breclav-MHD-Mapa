import { describe, expect, it } from 'vitest'
import { validateNetwork } from '../src/data/validate'
import { tinyNetwork } from './fixtures/tinyNetwork'

describe('validateNetwork', () => {
    it('accepts the fixture network', () => {
        expect(() => validateNetwork(structuredClone(tinyNetwork))).not.toThrow()
    })

    it('rejects a pattern whose offsets length differs from its stops length', () => {
        const bad = structuredClone(tinyNetwork)
        bad.patterns[0]!.offsets = [0, 4]
        expect(() => validateNetwork(bad)).toThrow(/offsets/i)
    })

    it('rejects a trip referencing an unknown pattern', () => {
        const bad = structuredClone(tinyNetwork)
        bad.trips[0]!.pattern = 'nope'
        expect(() => validateNetwork(bad)).toThrow(/nope/)
    })

    it('rejects a pattern referencing an unknown stop', () => {
        const bad = structuredClone(tinyNetwork)
        bad.patterns[0]!.stops[1] = 'ghost'
        expect(() => validateNetwork(bad)).toThrow(/ghost/)
    })

    it('rejects a day mask of the wrong length', () => {
        const bad = structuredClone(tinyNetwork) as unknown as { services: { days: number[] }[] }
        bad.services[0]!.days = [1, 1, 1]
        expect(() => validateNetwork(bad)).toThrow()
    })
})

describe('validateNetwork: dwells', () => {
    it('accepts a pattern and a trip override that carry dwells', () => {
        const net = structuredClone(tinyNetwork)
        net.patterns[0]!.dwells = [0, 2, 0]
        net.trips[1]!.dwells = [0, 1, 0]
        expect(net.patterns[0]!.offsets).toEqual([0, 4, 9])
        expect(net.trips[1]!.offsets).toEqual([0, 3, 7])
        expect(() => validateNetwork(net)).not.toThrow()
    })

    it('rejects a pattern whose dwells length differs from its stops length', () => {
        const bad = structuredClone(tinyNetwork)
        expect(bad.patterns[0]!.stops).toHaveLength(3)
        bad.patterns[0]!.dwells = [0, 2]
        expect(() => validateNetwork(bad)).toThrow(/pattern 563-0-1: dwells length 2 != stops length 3/)
    })

    it("rejects a trip whose dwells length differs from the pattern's stops length", () => {
        const bad = structuredClone(tinyNetwork)
        expect(bad.patterns[0]!.stops).toHaveLength(3)
        expect(bad.trips[1]!.offsets).toHaveLength(3)
        bad.trips[1]!.dwells = [0, 1]
        expect(() => validateNetwork(bad)).toThrow(/trip on 563-0-1: override dwells length 2 != stops length/)
    })

    it('rejects a trip carrying dwells without its own offsets', () => {
        const bad = structuredClone(tinyNetwork)
        expect(bad.trips[0]!.offsets).toBeUndefined()
        bad.trips[0]!.dwells = [0, 1, 0]
        expect(() => validateNetwork(bad)).toThrow(/trip on 563-0-1: override dwells without override offsets/)
    })

    it("rejects a pattern whose dwell pushes its departure past the next stop's arrival", () => {
        const bad = structuredClone(tinyNetwork)
        expect(bad.patterns[0]!.offsets).toEqual([0, 4, 9])
        bad.patterns[0]!.dwells = [0, 6, 0]
        expect(() => validateNetwork(bad)).toThrow(
            /pattern 563-0-1: departure at index 1 falls after the arrival at index 2/,
        )
    })

    it('accepts a dwell that ends exactly on the next arrival', () => {
        const net = structuredClone(tinyNetwork)
        expect(net.patterns[0]!.offsets).toEqual([0, 4, 9])
        net.patterns[0]!.dwells = [0, 5, 0]
        expect(() => validateNetwork(net)).not.toThrow()
    })

    it("rejects a trip override whose dwell pushes its departure past the next stop's arrival", () => {
        const bad = structuredClone(tinyNetwork)
        expect(bad.trips[1]!.offsets).toEqual([0, 3, 7])
        bad.trips[1]!.dwells = [0, 5, 0]
        expect(() => validateNetwork(bad)).toThrow(
            /trip on 563-0-1: departure at index 1 falls after the arrival at index 2/,
        )
    })
})
