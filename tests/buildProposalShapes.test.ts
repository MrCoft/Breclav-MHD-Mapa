import { describe, expect, it } from 'vitest'
import { buildShapesForSection } from '../scripts/build-proposal'
import { buildPatternsAndTrips } from '../scripts/gtfs/convert'
import { parseSections } from '../scripts/proposal/sheet'
import type { Grid, Section } from '../scripts/proposal/sheet'
import type { Stop } from '../src/types/network'

// Known bug 7 and decision 32: the workbook writes a timing point the vehicle stands at as two
// rows for the same stop, an arrival (`příj.`) and a departure (`odj.`). Those two rows are one
// stop visit carrying a dwell, not two stops with a 0 m segment between them.

function grid(cells: Record<string, string>): Grid {
    return new Map(Object.entries(cells))
}

const NAMES: Record<string, string> = {
    hrbitov: 'Městský hřbitov',
    palacha: 'Jana Palacha',
    nadrazi: 'Autobusové nádraží',
    sovadinova: 'Sovadinova',
    stara: 'Stará Břeclav, Lidická',
    pohansko: 'Pohansko, rozc.',
    gumotex: 'Gumotex',
    konecna: 'Poštorná, Valtická točna',
}

const stopById = new Map<string, Stop>(
    Object.entries(NAMES).map(([id, name]) => [id, { id, name, lat: 48.75, lon: 16.88 }]),
)

const SERVICE_ID = 'vsedni-den'

/** The one section of a single-section fixture sheet, with its stop rows asserted against the
 *  `resolvedIds` the caller pairs them with — a fixture that drifts out of alignment would
 *  otherwise quietly test a different route than the one written down. */
function sectionOf(sheet: Grid, expectedNames: string[]): Section {
    const sections = parseSections(sheet)
    expect(sections).toHaveLength(1)
    expect(sections[0]!.stops.map((s) => s.name)).toEqual(expectedNames)
    return sections[0]!
}

describe('buildShapesForSection collapses an arrival/departure row pair', () => {
    // Trip 1 serves both rows of the bus-station pair; trip 2 only its arrival row; trip 3 only
    // its departure row — all three shapes of the pair the workbook actually contains.
    const sheet = grid({
        '4:A': 'Tč',
        '4:D': '1',
        '4:E': '2',
        '4:F': '3',
        '5:A': '1',
        '5:B': NAMES.hrbitov!,
        '5:C': 'odj.',
        '5:D': '6:00',
        '5:E': '7:00',
        '5:F': '8:00',
        '6:A': '2',
        '6:B': NAMES.palacha!,
        '6:D': '6:03',
        '6:E': '7:03',
        '6:F': '8:03',
        '7:A': '3',
        '7:B': NAMES.nadrazi!,
        '7:C': 'příj.',
        '7:D': '6:05',
        '7:E': '7:05',
        '7:F': '~',
        '8:A': '4',
        '8:B': NAMES.nadrazi!,
        '8:C': 'odj.',
        '8:D': '6:09',
        '8:E': '~',
        '8:F': '8:05',
        '9:A': '5',
        '9:B': NAMES.sovadinova!,
        '9:D': '6:12',
        '9:E': '7:12',
        '9:F': '8:12',
        '10:A': '6',
        '10:B': NAMES.stara!,
        '10:D': '6:15',
        '10:E': '7:15',
        '10:F': '8:15',
    })
    const section = sectionOf(sheet, [
        NAMES.hrbitov!,
        NAMES.palacha!,
        NAMES.nadrazi!,
        NAMES.nadrazi!,
        NAMES.sovadinova!,
        NAMES.stara!,
    ])
    const resolvedIds = ['hrbitov', 'palacha', 'nadrazi', 'nadrazi', 'sovadinova', 'stara']
    const shapes = buildShapesForSection('569', 0, sheet, section, resolvedIds, stopById, SERVICE_ID)

    it('reads the pair as two rows in the sheet', () => {
        // The arrange step: without two consecutive rows resolving to one stop there is nothing
        // for the collapse to do, and every assertion below would pass on an empty change.
        expect(section.stops[2]!.marker).toBe('příj.')
        expect(section.stops[3]!.marker).toBe('odj.')
        expect(resolvedIds[2]).toBe(resolvedIds[3])
    })

    it('gives a trip serving both rows one stop with a dwell equal to the gap', () => {
        const [both] = shapes
        expect(both!.tripId).toBe('569-0-1')
        expect(both!.serviceId).toBe(SERVICE_ID)
        expect(both!.stops).toEqual(['hrbitov', 'palacha', 'nadrazi', 'sovadinova', 'stara'])
        expect(both!.arrivals).toEqual([360, 363, 365, 372, 375])
        expect(both!.dwells).toEqual([0, 0, 4, 0, 0])
    })

    it('gives a trip serving only the arrival row one stop and no dwell', () => {
        const arrivalOnly = shapes[1]!
        expect(arrivalOnly.stops).toEqual(['hrbitov', 'palacha', 'nadrazi', 'sovadinova', 'stara'])
        expect(arrivalOnly.arrivals[2]).toBe(425)
        expect(arrivalOnly.dwells).toEqual([0, 0, 0, 0, 0])
    })

    it('gives a trip serving only the departure row one stop and no dwell', () => {
        const departureOnly = shapes[2]!
        expect(departureOnly.stops).toEqual(['hrbitov', 'palacha', 'nadrazi', 'sovadinova', 'stara'])
        expect(departureOnly.arrivals[2]).toBe(485)
        expect(departureOnly.dwells).toEqual([0, 0, 0, 0, 0])
    })

    it('leaves the station once in the pattern the three trips share', () => {
        const { patterns, trips } = buildPatternsAndTrips(shapes, new Map([['569', '569']]))
        expect(patterns).toHaveLength(1)
        expect(patterns[0]!.stops.filter((id) => id === 'nadrazi')).toEqual(['nadrazi'])
        expect(trips).toHaveLength(3)
    })
})

describe('buildShapesForSection applies decision 32’s end rules', () => {
    // A pair at each end: the origin's five minutes of standing time before the trip starts, and
    // the terminus' fifteen-minute layover after it ends, are both the operator's, not a rider's.
    const sheet = grid({
        '4:A': 'Tč',
        '4:D': '1',
        '5:A': '1',
        '5:B': NAMES.hrbitov!,
        '5:C': 'příj.',
        '5:D': '6:00',
        '6:A': '2',
        '6:B': NAMES.hrbitov!,
        '6:C': 'odj.',
        '6:D': '6:05',
        '7:A': '3',
        '7:B': NAMES.palacha!,
        '7:D': '6:10',
        '8:A': '4',
        '8:B': NAMES.konecna!,
        '8:C': 'příj.',
        '8:D': '6:20',
        '9:A': '5',
        '9:B': NAMES.konecna!,
        '9:C': 'odj.',
        '9:D': '6:35',
    })
    const section = sectionOf(sheet, [NAMES.hrbitov!, NAMES.hrbitov!, NAMES.palacha!, NAMES.konecna!, NAMES.konecna!])
    const [shape] = buildShapesForSection(
        '567',
        1,
        sheet,
        section,
        ['hrbitov', 'hrbitov', 'palacha', 'konecna', 'konecna'],
        stopById,
        SERVICE_ID,
    )

    it('reads both waits from the sheet', () => {
        expect(section.stops.map((s) => s.marker)).toEqual(['příj.', 'odj.', '', 'příj.', 'odj.'])
    })

    it('starts the trip at the origin’s departure, not its arrival', () => {
        expect(shape!.stops).toEqual(['hrbitov', 'palacha', 'konecna'])
        expect(shape!.arrivals).toEqual([365, 370, 380])
    })

    it('carries no dwell at the first or the last stop', () => {
        expect(shape!.dwells).toEqual([0, 0, 0])
    })
})

describe('buildShapesForSection keeps a stop a trip genuinely calls at twice', () => {
    const sheet = grid({
        '4:A': 'Tč',
        '4:D': '1',
        '5:A': '1',
        '5:B': NAMES.hrbitov!,
        '5:D': '6:00',
        '6:A': '2',
        '6:B': NAMES.pohansko!,
        '6:D': '6:04',
        '7:A': '3',
        '7:B': NAMES.gumotex!,
        '7:D': '6:06',
        '8:A': '4',
        '8:B': NAMES.pohansko!,
        '8:D': '6:08',
        '9:A': '5',
        '9:B': NAMES.nadrazi!,
        '9:D': '6:12',
    })
    const section = sectionOf(sheet, [NAMES.hrbitov!, NAMES.pohansko!, NAMES.gumotex!, NAMES.pohansko!, NAMES.nadrazi!])
    const [shape] = buildShapesForSection(
        '566',
        0,
        sheet,
        section,
        ['hrbitov', 'pohansko', 'gumotex', 'pohansko', 'nadrazi'],
        stopById,
        SERVICE_ID,
    )

    it('keeps both calls, because the trip serves a stop between them', () => {
        expect(shape!.stops).toEqual(['hrbitov', 'pohansko', 'gumotex', 'pohansko', 'nadrazi'])
        expect(shape!.arrivals).toEqual([360, 364, 366, 368, 372])
        expect(shape!.dwells).toEqual([0, 0, 0, 0, 0])
    })
})

describe('buildShapesForSection collapses a pair the sheet writes rows apart', () => {
    // Line 569's real shape: the sheet lays the Městský hřbitov leg out between the station's two
    // calls, and each trip runs one variant or the other. A trip that runs straight through serves
    // neither of the rows in between, so its two calls at the station are still one stand.
    const sheet = grid({
        '4:A': 'Tč',
        '4:D': '1',
        '4:E': '2',
        '5:A': '1',
        '5:B': NAMES.sovadinova!,
        '5:D': '6:00',
        '5:E': '7:00',
        '6:A': '2',
        '6:B': NAMES.nadrazi!,
        '6:C': 'příj.',
        '6:D': '6:04',
        '6:E': '~',
        '7:A': '3',
        '7:B': NAMES.hrbitov!,
        '7:D': '~',
        '7:E': '7:04',
        '8:A': '4',
        '8:B': NAMES.gumotex!,
        '8:D': '~',
        '8:E': '7:06',
        '9:A': '5',
        '9:B': NAMES.nadrazi!,
        '9:C': 'odj.',
        '9:D': '6:08',
        '9:E': '7:09',
        '10:A': '6',
        '10:B': NAMES.palacha!,
        '10:D': '6:11',
        '10:E': '7:12',
    })
    const section = sectionOf(sheet, [
        NAMES.sovadinova!,
        NAMES.nadrazi!,
        NAMES.hrbitov!,
        NAMES.gumotex!,
        NAMES.nadrazi!,
        NAMES.palacha!,
    ])
    const shapes = buildShapesForSection(
        '569',
        0,
        sheet,
        section,
        ['sovadinova', 'nadrazi', 'hrbitov', 'gumotex', 'nadrazi', 'palacha'],
        stopById,
        SERVICE_ID,
    )

    it('separates the two station rows by rows in the sheet', () => {
        expect(section.stops[1]!.row).toBe(6)
        expect(section.stops[4]!.row).toBe(9)
    })

    it('collapses them for the trip that serves nothing in between', () => {
        const straightThrough = shapes[0]!
        expect(straightThrough.stops).toEqual(['sovadinova', 'nadrazi', 'palacha'])
        expect(straightThrough.arrivals).toEqual([360, 364, 371])
        expect(straightThrough.dwells).toEqual([0, 4, 0])
    })

    it('leaves the trip that runs the detour with one call at the station', () => {
        const viaHrbitov = shapes[1]!
        expect(viaHrbitov.stops).toEqual(['sovadinova', 'hrbitov', 'gumotex', 'nadrazi', 'palacha'])
        expect(viaHrbitov.arrivals).toEqual([420, 424, 426, 429, 432])
        expect(viaHrbitov.dwells).toEqual([0, 0, 0, 0, 0])
    })
})
