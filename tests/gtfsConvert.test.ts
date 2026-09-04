import { describe, expect, it } from 'vitest'
import { assignLineIds, buildPatternsAndTrips, buildServices, parseGtfsTime, tripTiming } from '../scripts/gtfs/convert'
import type { StopVisit, TripShape } from '../scripts/gtfs/convert'
import type { GtfsCalendarDateRow, GtfsCalendarRow, GtfsRouteRow } from '../scripts/gtfs/scope'

describe('parseGtfsTime', () => {
    it('parses a normal time to minutes', () => {
        expect(parseGtfsTime('06:14:00')).toBe(374)
    })

    it('keeps times past midnight above 1440', () => {
        expect(parseGtfsTime('25:10:00')).toBe(1510)
    })
})

describe('tripTiming', () => {
    // Trip 6387 of line 572 as the feed gives it (known bug 6): it reaches Hodonín at 7:42, and
    // the 13:18 the feed prints there is the vehicle's next duty, not this trip's departure.
    const trip6387: StopVisit[] = [
        { stop: 'breclav-aut-nadr', arrival: 420, departure: 423 }, // 07:00, leaves 07:03
        { stop: 'ladna', arrival: 437, departure: 439 }, // 07:17, leaves 07:19
        { stop: 'hodonin-aut-nadr', arrival: 462, departure: 798 }, // 07:42, "leaves" 13:18
    ]

    it('takes the departure at the first stop, and never a dwell there', () => {
        expect(trip6387[0]!.departure - trip6387[0]!.arrival).toBe(3)
        const { arrivals, dwells } = tripTiming('6387', trip6387)
        expect(arrivals[0]).toBe(423)
        expect(dwells[0]).toBe(0)
    })

    it('takes the arrival at an intermediate stop, with the wait as its dwell', () => {
        const { arrivals, dwells } = tripTiming('6387', trip6387)
        expect(arrivals[1]).toBe(437)
        expect(dwells[1]).toBe(2)
    })

    it('takes the arrival at the last stop, dropping the terminus layover', () => {
        expect(trip6387.at(-1)!.departure - trip6387.at(-1)!.arrival).toBe(336)
        const { arrivals, dwells } = tripTiming('6387', trip6387)
        expect(arrivals.at(-1)).toBe(462)
        expect(dwells.at(-1)).toBe(0)
    })

    it('throws naming the trip and the stop when a departure precedes its own arrival', () => {
        const backwards: StopVisit[] = [
            { stop: 'a', arrival: 420, departure: 420 },
            { stop: 'ladna', arrival: 437, departure: 435 },
            { stop: 'c', arrival: 462, departure: 462 },
        ]
        expect(() => tripTiming('6387', backwards)).toThrow(/6387.*ladna|ladna.*6387/s)
    })
})

describe('assignLineIds', () => {
    const routes: GtfsRouteRow[] = [
        {
            route_id: 'L563D99',
            route_short_name: '563',
            route_long_name: '',
            route_type: '3',
            route_color: '2C89C8',
            route_text_color: 'FFFFFF',
        },
        {
            route_id: 'L900D99',
            route_short_name: '563',
            route_long_name: '',
            route_type: '2',
            route_color: '800000',
            route_text_color: 'FFFFFF',
        },
        {
            route_id: 'L136D99',
            route_short_name: 'R50',
            route_long_name: '',
            route_type: '2',
            route_color: '800000',
            route_text_color: 'E1CB31',
        },
    ]

    it('uses the short name when it is unique', () => {
        expect(assignLineIds(routes).get('L136D99')).toBe('R50')
    })

    it('falls back to the route id when short names collide', () => {
        const ids = assignLineIds(routes)
        expect(ids.get('L563D99')).toBe('L563D99')
        expect(ids.get('L900D99')).toBe('L900D99')
    })
})

describe('buildServices', () => {
    const calendar: GtfsCalendarRow[] = [
        {
            service_id: '1',
            monday: '1',
            tuesday: '1',
            wednesday: '1',
            thursday: '1',
            friday: '1',
            saturday: '0',
            sunday: '0',
            start_date: '20260830',
            end_date: '20261212',
        },
    ]
    const exceptions: GtfsCalendarDateRow[] = [
        { service_id: '1', date: '20261117', exception_type: '2' },
        { service_id: '1', date: '20260905', exception_type: '1' },
        { service_id: '2', date: '20260906', exception_type: '1' },
    ]

    it('converts the day mask with Monday first', () => {
        expect(buildServices(calendar, exceptions)[0]!.days).toEqual([1, 1, 1, 1, 1, 0, 0])
    })

    it('formats dates as ISO', () => {
        const service = buildServices(calendar, exceptions)[0]!
        expect(service.from).toBe('2026-08-30')
        expect(service.to).toBe('2026-12-12')
    })

    it('splits exceptions into added and removed', () => {
        const service = buildServices(calendar, exceptions)[0]!
        expect(service.added).toEqual(['2026-09-05'])
        expect(service.removed).toEqual(['2026-11-17'])
    })

    it('creates a service for an id that only appears in calendar_dates', () => {
        const only = buildServices(calendar, exceptions).find((s) => s.id === '2')
        expect(only).toBeDefined()
        expect(only!.days).toEqual([0, 0, 0, 0, 0, 0, 0])
        expect(only!.added).toEqual(['2026-09-06'])
    })
})

describe('buildPatternsAndTrips', () => {
    const lineIds = new Map([['L563D99', '563']])

    const shape = (
        tripId: string,
        arrivals: number[],
        dwells = arrivals.map(() => 0),
        stops = ['a', 'b', 'c'],
    ): TripShape => ({
        tripId,
        routeId: 'L563D99',
        directionId: 0,
        headsign: 'FOSFA',
        serviceId: '1',
        stops,
        arrivals,
        dwells,
    })

    it('groups trips sharing a stop sequence into one pattern', () => {
        const { patterns } = buildPatternsAndTrips(
            [shape('t1', [360, 364, 369]), shape('t2', [420, 424, 429])],
            lineIds,
        )
        expect(patterns).toHaveLength(1)
        expect(patterns[0]!.stops).toEqual(['a', 'b', 'c'])
        expect(patterns[0]!.offsets).toEqual([0, 4, 9])
    })

    it('separates patterns that differ in stop sequence', () => {
        const { patterns } = buildPatternsAndTrips(
            [shape('t1', [360, 364, 369]), shape('t2', [420, 424], [0, 0], ['a', 'b'])],
            lineIds,
        )
        expect(patterns).toHaveLength(2)
        expect(patterns.map((p) => p.id)).toEqual(['563-0-1', '563-0-2'])
    })

    it('uses the modal run times for the pattern and overrides the minority', () => {
        const { patterns, trips } = buildPatternsAndTrips(
            [shape('t1', [360, 364, 369]), shape('t2', [420, 424, 429]), shape('t3', [480, 483, 487])],
            lineIds,
        )
        expect(patterns[0]!.offsets).toEqual([0, 4, 9])
        const overrides = trips.filter((t) => t.offsets !== undefined)
        expect(overrides).toHaveLength(1)
        expect(overrides[0]!.offsets).toEqual([0, 3, 7])
        expect(overrides[0]!.start).toBe(480)
    })

    it('records each trip start as the first stop time', () => {
        const { trips } = buildPatternsAndTrips([shape('t1', [360, 364, 369])], lineIds)
        expect(trips[0]!.start).toBe(360)
        expect(trips[0]!.service).toBe('1')
    })

    it('sorts trips deterministically by pattern then start', () => {
        const { trips } = buildPatternsAndTrips([shape('t2', [420, 424, 429]), shape('t1', [360, 364, 369])], lineIds)
        expect(trips.map((t) => t.start)).toEqual([360, 420])
    })

    it('carries the modal dwells on the pattern, beside the offsets', () => {
        const { patterns } = buildPatternsAndTrips(
            [shape('t1', [360, 364, 369], [0, 2, 0]), shape('t2', [420, 424, 429], [0, 2, 0])],
            lineIds,
        )
        expect(patterns).toHaveLength(1)
        expect(patterns[0]!.offsets).toEqual([0, 4, 9])
        expect(patterns[0]!.dwells).toEqual([0, 2, 0])
    })

    it('omits dwells entirely when the vehicle stands nowhere', () => {
        const { patterns, trips } = buildPatternsAndTrips(
            [shape('t1', [360, 364, 369]), shape('t2', [480, 484, 489])],
            lineIds,
        )
        expect(patterns[0]!.offsets).toEqual([0, 4, 9])
        expect('dwells' in patterns[0]!).toBe(false)
        expect(trips.filter((t) => 'dwells' in t)).toEqual([])
    })

    // Keying the modal tally on offsets alone would make this one pattern with no override at
    // all, and t3 would silently inherit the 2-minute wait it does not have.
    it('overrides a trip that matches the modal offsets but not the modal dwells', () => {
        const { patterns, trips } = buildPatternsAndTrips(
            [
                shape('t1', [360, 364, 369], [0, 2, 0]),
                shape('t2', [420, 424, 429], [0, 2, 0]),
                shape('t3', [480, 484, 489], [0, 5, 0]),
            ],
            lineIds,
        )
        expect(patterns).toHaveLength(1)
        expect(patterns[0]!.dwells).toEqual([0, 2, 0])

        const overrides = trips.filter((t) => t.offsets !== undefined)
        expect(overrides).toHaveLength(1)
        expect(overrides[0]!.start).toBe(480)
        expect(overrides[0]!.offsets).toEqual([0, 4, 9])
        expect(overrides[0]!.dwells).toEqual([0, 5, 0])
    })

    // `vehicleForTrip` and `departuresAt` read a trip's offsets and dwells as a pair, so dwells
    // alone would be read against the pattern's offsets — `validateNetwork` rejects it outright.
    it('gives an overriding trip both vectors or neither, never dwells alone', () => {
        const { patterns, trips } = buildPatternsAndTrips(
            [
                shape('t1', [360, 364, 369], [0, 2, 0]),
                shape('t2', [420, 424, 429], [0, 2, 0]),
                shape('t3', [480, 484, 489]),
                shape('t4', [540, 543, 547]),
            ],
            lineIds,
        )
        expect(patterns[0]!.dwells).toEqual([0, 2, 0])
        expect(trips.filter((t) => t.offsets !== undefined)).toHaveLength(2)
        expect(trips.filter((t) => t.dwells !== undefined && t.offsets === undefined)).toEqual([])

        const standsNowhere = trips.find((t) => t.start === 480)!
        expect(standsNowhere.offsets).toEqual([0, 4, 9])
        expect('dwells' in standsNowhere).toBe(false)
    })
})
