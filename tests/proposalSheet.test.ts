import { describe, expect, it } from 'vitest'
import { findHeaderRows, parseSections, tripStopMinutes } from '../scripts/proposal/sheet'
import type { Grid } from '../scripts/proposal/sheet'

/** Builds a Grid from `{ "5:B": "Autobusové nádraží", ... }`-style entries. */
function grid(cells: Record<string, string>): Grid {
    return new Map(Object.entries(cells))
}

// A small stand-in for line 563's real shape: two sections, each with its own "Tč" header row
// reusing the same columns (D, E) for different trip numbers, one stop skipped ("~") on one
// trip, and a per-trip "km" total row that must not be read as a stop.
const twoSectionSheet = grid({
    '1:A': 'Linka číslo 745563',
    '4:A': 'Tč',
    '4:D': '1',
    '4:E': '3',
    '5:A': '1',
    '5:B': 'Autobusové nádraží',
    '5:C': 'odj.',
    '5:D': '0.2',
    '5:E': '0.25',
    '6:A': '2',
    '6:B': 'Jana Palacha',
    '6:D': '~',
    '6:E': '0.26',
    '7:B': 'km',
    '7:D': '1.8',
    '7:E': '6.9',
    '9:A': 'Linka číslo 745563',
    '11:A': 'Tč',
    '11:D': '2',
    '11:E': '4',
    '12:A': '2',
    '12:B': 'Jana Palacha',
    '12:D': '0.3',
    '12:E': '0.31',
    '13:A': '1',
    '13:B': 'Autobusové nádraží',
    '13:C': 'příj.',
    '13:D': '0.32',
    '13:E': '0.33',
    '14:B': 'km',
    '14:D': '1.8',
    '14:E': '6.9',
})

describe('findHeaderRows', () => {
    it('finds every "Tč" row, not just the first', () => {
        expect(findHeaderRows(twoSectionSheet)).toEqual([4, 11])
    })
})

describe('parseSections', () => {
    const sections = parseSections(twoSectionSheet)

    it('splits the sheet into one section per header row', () => {
        expect(sections).toHaveLength(2)
    })

    it('reads each section’s own trip columns, independent of the other section’s', () => {
        expect(sections[0]!.tripColumns).toEqual([
            { number: '1', column: 'D' },
            { number: '3', column: 'E' },
        ])
        expect(sections[1]!.tripColumns).toEqual([
            { number: '2', column: 'D' },
            { number: '4', column: 'E' },
        ])
    })

    it('reads each section’s own stop rows, in row order, with their markers', () => {
        expect(sections[0]!.stops).toEqual([
            { row: 5, name: 'Autobusové nádraží', marker: 'odj.' },
            { row: 6, name: 'Jana Palacha', marker: '' },
        ])
        expect(sections[1]!.stops).toEqual([
            { row: 12, name: 'Jana Palacha', marker: '' },
            { row: 13, name: 'Autobusové nádraží', marker: 'příj.' },
        ])
    })

    it('excludes the per-trip "km" total row from both sections’ stops', () => {
        for (const section of sections) {
            expect(section.stops.some((s) => s.name.toLowerCase() === 'km')).toBe(false)
        }
    })

    it('excludes a "km" row whose own label is garbled (562’s "X+X50")', () => {
        const withGarbledTotal: Grid = new Map(twoSectionSheet)
        withGarbledTotal.delete('7:B')
        withGarbledTotal.set('7:B', 'X+X50')
        withGarbledTotal.set('7:D', '10.6')
        withGarbledTotal.set('7:E', '9.8')
        const [first] = parseSections(withGarbledTotal)
        expect(first!.stops.some((s) => s.name === 'X+X50')).toBe(false)
    })

    it('does not drop a real stop merely for having one implausible cell', () => {
        // A single stray value near the day-fraction boundary must not disqualify a real stop —
        // only a row where *most* of its populated cells look like distances does.
        const withOneOddCell: Grid = new Map(twoSectionSheet)
        withOneOddCell.set('6:D', '1.3') // one implausible value; 6:E ("0.26") is still a real time
        const [first] = parseSections(withOneOddCell)
        expect(first!.stops.some((s) => s.name === 'Jana Palacha')).toBe(true)
    })
})

describe('tripStopMinutes', () => {
    it('reads a stop’s time for one trip column', () => {
        expect(tripStopMinutes(twoSectionSheet, 5, 'D')).toBe(Math.round(0.2 * 1440))
    })

    it('returns undefined for a skipped ("~") cell', () => {
        expect(tripStopMinutes(twoSectionSheet, 6, 'D')).toBeUndefined()
    })
})
