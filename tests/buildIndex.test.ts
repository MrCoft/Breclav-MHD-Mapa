import { describe, expect, it } from 'vitest'
import { buildIndex } from '../src/data/buildIndex'
import { expandFrequencies } from '../src/data/expandFrequencies'
import { tinyNetwork } from './fixtures/tinyNetwork'
import type { Network } from '../src/types/network'

describe('expandFrequencies', () => {
    it('returns explicit trips unchanged when there are no frequency blocks', () => {
        expect(expandFrequencies(tinyNetwork)).toHaveLength(3)
    })

    it('expands a headway block inclusively of both ends', () => {
        const net: Network = {
            ...structuredClone(tinyNetwork),
            trips: [],
            frequencies: [{ pattern: '563-0-1', service: 'weekday', from: 300, to: 360, headway: 20 }],
        }
        expect(expandFrequencies(net).map((t) => t.start)).toEqual([300, 320, 340, 360])
    })

    it('throws on a non-positive headway rather than looping forever', () => {
        const net: Network = {
            ...structuredClone(tinyNetwork),
            frequencies: [{ pattern: '563-0-1', service: 'weekday', from: 300, to: 360, headway: 0 }],
        }
        expect(() => expandFrequencies(net)).toThrow(/headway/i)
    })
})

describe('buildIndex', () => {
    const index = buildIndex(tinyNetwork)

    it('indexes each stop position within its pattern', () => {
        expect(index.patternsByStop.get('b')).toEqual([{ pattern: tinyNetwork.patterns[0], index: 1 }])
    })

    it('records every occurrence of a stop that appears twice in one pattern', () => {
        const looped = structuredClone(tinyNetwork)
        looped.patterns[0]!.stops = ['a', 'b', 'a']
        looped.patterns[0]!.offsets = [0, 4, 9]
        expect(
            buildIndex(looped)
                .patternsByStop.get('a')
                ?.map((p) => p.index),
        ).toEqual([0, 2])
    })

    it('groups trips by pattern', () => {
        expect(index.tripsByPattern.get('563-0-1')).toHaveLength(3)
    })

    it('lists lines serving a stop, without duplicates', () => {
        expect(index.linesByStop.get('a')?.map((l) => l.id)).toEqual(['563'])
    })

    it('includes frequency-expanded trips', () => {
        const net: Network = {
            ...structuredClone(tinyNetwork),
            trips: [],
            frequencies: [{ pattern: '563-0-1', service: 'weekday', from: 300, to: 360, headway: 20 }],
        }
        expect(buildIndex(net).tripsByPattern.get('563-0-1')).toHaveLength(4)
    })
})
