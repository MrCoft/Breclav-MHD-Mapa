import { describe, expect, it } from 'vitest'
import { buildIndex } from '../src/data/buildIndex'
import { departuresAt } from '../src/domain/departures'
import { tinyNetwork } from './fixtures/tinyNetwork'

const index = buildIndex(tinyNetwork)

describe('departuresAt', () => {
    it('returns the weekday departure from the first stop', () => {
        // Wednesday with Tuesday before it (both weekday service).
        // Includes the 1450 trip from Tuesday (time=10 on Wednesday) and the 374 trip from Wednesday.
        const found = departuresAt(index, 'a', '2026-09-02', 0)
        expect(found.map((d) => d.time)).toEqual([10, 374])
        expect(found[0]!.serviceDate).toBe('2026-09-01')
        expect(found[1]!.serviceDate).toBe('2026-09-02')
    })

    it('applies the pattern offset at a later stop', () => {
        // Stop 'c' has pattern offsets: 9 (Trip 1), 7 (Trip 2).
        // From Tuesday: 1450 + 7 - 1440 = 17; from Wednesday: 374 + 9 = 383.
        const found = departuresAt(index, 'c', '2026-09-02', 0)
        expect(found.map((d) => d.time)).toEqual([17, 383])
        expect(found[0]!.serviceDate).toBe('2026-09-01')
        expect(found[1]!.serviceDate).toBe('2026-09-02')
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
        // Saturday 2026-09-05 (added to weekday) with Friday before it.
        // Returns earliest departure with limit=1: the 1450 trip from Friday (time=10).
        const found = departuresAt(index, 'a', '2026-09-05', 0, 1)
        expect(found).toHaveLength(1)
        expect(found[0]!.time).toBe(10)
        expect(found[0]!.serviceDate).toBe('2026-09-04')
    })

    it('returns an empty array for an unknown stop', () => {
        expect(departuresAt(index, 'nope', '2026-09-02', 0)).toEqual([])
    })

    it('includes post-midnight trips on normal consecutive weekdays', () => {
        // Monday 2026-09-07 and Tuesday 2026-09-08 both run weekday service.
        // The 1450 trip from Monday departs stop 'a' at 00:10 on Tuesday.
        // This regression test ensures post-midnight trips appear on regular days,
        // not just when the next day has a service exception.
        const found = departuresAt(index, 'a', '2026-09-08', 0)
        expect(found).toHaveLength(2)
        expect(found[0]!.time).toBe(10)
        expect(found[0]!.serviceDate).toBe('2026-09-07')
        expect(found[1]!.time).toBe(374)
        expect(found[1]!.serviceDate).toBe('2026-09-08')
    })
})
