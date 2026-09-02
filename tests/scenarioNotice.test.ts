import { describe, expect, it } from 'vitest'
import { buildIndex } from '../src/data/buildIndex'
import { hasOwnService } from '../src/ui/ScenarioNotice'
import { tinyNetwork } from './fixtures/tinyNetwork'
import type { Network } from '../src/types/network'

// tinyNetwork's only pattern is on line '563', running on 'weekday' (Mon-Fri) and 'weekend'
// (Sat-Sun) services. A second line, '571', stands in for a line inherited from another scenario
// unchanged — the same relationship `build-proposal.ts`'s `meta.inheritedLines` records for the
// real 571/574 — with its own trip on 'weekend' only, so it is the sole service running on a
// Saturday once 563's own weekday-only trips are excluded.
const withInherited: Network = {
    ...tinyNetwork,
    lines: [
        ...tinyNetwork.lines,
        { id: '571', name: '571', longName: '571', mode: 'bus', color: '#000000', textColor: '#FFFFFF' },
    ],
    patterns: [
        ...tinyNetwork.patterns,
        { id: '571-0-1', line: '571', direction: 0, headsign: 'X', stops: ['a', 'b'], offsets: [0, 5] },
    ],
    // Drops tinyNetwork's own 563-on-'weekend' trip: this fixture needs 563 (non-inherited) to
    // run weekdays only, so 571 (inherited) is the sole service running on a Saturday.
    trips: [
        ...tinyNetwork.trips.filter((t) => t.service !== 'weekend'),
        { pattern: '571-0-1', service: 'weekend', start: 400 },
    ],
}
const index = buildIndex(withInherited)
const inheritedLineIds = new Set(['571'])

// A Saturday clear of tinyNetwork's own `added`/`removed` exceptions ('2026-09-05', '2026-09-03'
// — see the fixture), so only the day mask decides what runs.
const SATURDAY = '2026-09-12'
const WEDNESDAY = '2026-09-02'
const OUT_OF_RANGE = '2027-01-01'

describe('hasOwnService', () => {
    it('is true on a weekday, when the non-inherited line 563 runs', () => {
        expect(hasOwnService(index, WEDNESDAY, inheritedLineIds)).toBe(true)
    })

    it('is false on a weekend, when only the inherited line 571 runs', () => {
        expect(hasOwnService(index, SATURDAY, inheritedLineIds)).toBe(false)
    })

    it('is false on a date with no active service at all', () => {
        expect(hasOwnService(index, OUT_OF_RANGE, inheritedLineIds)).toBe(false)
    })

    it('control: the weekday case goes false once 563 itself is treated as inherited too', () => {
        // Asserts the *setup*, not just the behaviour (CLAUDE.md #9): if `hasOwnService` ignored
        // `inheritedLineIds` entirely, the weekday test above would read true for the wrong
        // reason (any active service at all, not specifically a non-inherited one). Widening the
        // inherited set to cover every line on the network forces the function to fall through
        // to "no non-inherited service", proving the exclusion is actually doing the filtering.
        const everyLine = new Set(['563', '571'])
        expect(hasOwnService(index, WEDNESDAY, everyLine)).toBe(false)
        expect(hasOwnService(index, SATURDAY, everyLine)).toBe(false)
    })
})
