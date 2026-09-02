import { describe, expect, it } from 'vitest'
import { coreWeekdayService } from '../scripts/build-proposal'
import type { Service } from '../src/types/network'

// Findings I8/I10: build-proposal.ts used to hard-code the proposed service's date range and
// `removed` holidays. `coreWeekdayService` replaces that by picking the current scenario's own
// widest Monday-Friday service — these tests exercise that selection directly.

const weekend: Service = { id: 'weekend', days: [0, 0, 0, 0, 0, 1, 1], from: '2026-08-29', to: '2026-12-12' }
const shortWeekday: Service = {
    id: '3',
    days: [1, 1, 1, 1, 1, 0, 0],
    from: '2026-08-28',
    to: '2026-08-31',
}
const coreWeekday: Service = {
    id: '1',
    days: [1, 1, 1, 1, 1, 0, 0],
    from: '2026-08-28',
    to: '2026-12-11',
    removed: ['2026-09-28', '2026-10-28', '2026-11-17'],
}
const oddWeekday: Service = {
    id: '269',
    days: [1, 1, 1, 1, 1, 0, 0],
    from: '2026-09-11',
    to: '2026-09-11',
}

describe('coreWeekdayService', () => {
    it('picks the widest Monday-Friday service, ignoring weekend and short-lived ones', () => {
        const chosen = coreWeekdayService([weekend, shortWeekday, coreWeekday, oddWeekday])
        expect(chosen).toBe(coreWeekday)
    })

    it('carries the chosen service’s own removed dates', () => {
        const chosen = coreWeekdayService([shortWeekday, coreWeekday])
        expect(chosen.removed).toEqual(['2026-09-28', '2026-10-28', '2026-11-17'])
    })

    it('throws a clear error when the current scenario has no Monday-Friday service at all', () => {
        // Control arm (CLAUDE.md #9): proves the function actually filters by day mask, rather
        // than e.g. always returning the widest service regardless of which days it runs.
        expect(() => coreWeekdayService([weekend])).toThrow(/Monday-Friday/i)
    })
})
