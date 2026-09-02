import { describe, expect, it } from 'vitest'
import { buildIndex } from '../src/data/buildIndex'
import { departuresAt } from '../src/domain/departures'
import { tinyNetwork } from './fixtures/tinyNetwork'

const index = buildIndex(tinyNetwork)

describe('departuresAt', () => {
    it('returns the weekday departure from the first stop', () => {
        // Wednesday. Trip starts at 374, stop 'a' has offset 0. The 1450 trip
        // departs after midnight and so belongs to the next date's board.
        const found = departuresAt(index, 'a', '2026-09-02', 0)
        expect(found.map((d) => d.time)).toEqual([374])
    })

    it('applies the pattern offset at a later stop', () => {
        // Stop 'c' has pattern offset 9, so 374 + 9 = 383.
        const found = departuresAt(index, 'c', '2026-09-02', 0)
        expect(found.map((d) => d.time)).toEqual([383])
    })

    it('filters out departures before the requested time', () => {
        expect(departuresAt(index, 'a', '2026-09-02', 300).map((d) => d.time)).toEqual([374])
        expect(departuresAt(index, 'a', '2026-09-02', 400)).toEqual([])
    })

    it('finds a post-midnight departure belonging to the previous service day', () => {
        // Thursday 2026-09-03 is removed from the weekday service, so nothing runs
        // that day. But Wednesday's 1450 trip departs at 00:10 on Thursday morning.
        const found = departuresAt(index, 'a', '2026-09-03', 0)
        expect(found).toHaveLength(1)
        expect(found[0]!.time).toBe(10)
        expect(found[0]!.serviceDate).toBe('2026-09-02')
    })

    it('returns nothing when no service runs and no night trip spills over', () => {
        expect(departuresAt(index, 'a', '2026-09-03', 60)).toEqual([])
    })

    it('honours the limit and returns results in time order', () => {
        const found = departuresAt(index, 'a', '2026-09-05', 0, 1)
        expect(found).toHaveLength(1)
        expect(found[0]!.time).toBe(374)
    })

    it('returns an empty array for an unknown stop', () => {
        expect(departuresAt(index, 'nope', '2026-09-02', 0)).toEqual([])
    })
})
