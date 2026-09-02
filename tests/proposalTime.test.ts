import { describe, expect, it } from 'vitest'
import { cellToMinutes } from '../scripts/proposal/time'

describe('cellToMinutes', () => {
    it('rounds an Excel day-fraction to the nearest minute', () => {
        expect(cellToMinutes('0.21875')).toBe(315) // 05:15
    })

    it('rounds away a long floating tail', () => {
        expect(cellToMinutes('0.21874999999999983')).toBe(315)
    })

    it('parses a literal HH:MM cell', () => {
        expect(cellToMinutes('5:15')).toBe(315)
        expect(cellToMinutes('05:15')).toBe(315)
    })

    it('treats "~" as skipped', () => {
        expect(cellToMinutes('~')).toBeUndefined()
    })

    it('treats a missing cell as skipped', () => {
        expect(cellToMinutes(undefined)).toBeUndefined()
    })

    it('keeps times past midnight above 1440 rather than wrapping them', () => {
        // 25:10 as a day-fraction: 25:10 / 24:00 = 1510/1440
        expect(cellToMinutes(String(1510 / 1440))).toBe(1510)
    })

    it('returns undefined for text that is neither a fraction nor HH:MM', () => {
        expect(cellToMinutes('odj.')).toBeUndefined()
    })

    it('treats a whitespace-only cell as skipped, not as zero', () => {
        // JavaScript's Number('  ') is 0, not NaN — found on line 562's real workbook data,
        // where a stop the trip does not reach was left as two spaces rather than blank.
        expect(cellToMinutes('  ')).toBeUndefined()
        expect(cellToMinutes('')).toBeUndefined()
    })

    it('rejects a value implausible for any real day-fraction, rather than accepting it', () => {
        // Found on line 566's real workbook data: three trip columns have the literal text
        // "562" (very likely a stray line-number reference) where an arrival time belongs.
        // Number('562') is not NaN, so without this guard it would read as 809,280 minutes.
        expect(cellToMinutes('562')).toBeUndefined()
    })
})
