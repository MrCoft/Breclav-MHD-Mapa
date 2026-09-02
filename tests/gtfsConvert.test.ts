import { describe, expect, it } from 'vitest'
import { assignLineIds, buildPatternsAndTrips, buildServices, parseGtfsTime } from '../scripts/gtfs/convert'
import type { TripShape } from '../scripts/gtfs/convert'
import type { GtfsCalendarDateRow, GtfsCalendarRow, GtfsRouteRow } from '../scripts/gtfs/scope'

describe('parseGtfsTime', () => {
    it('parses a normal time to minutes', () => {
        expect(parseGtfsTime('06:14:00')).toBe(374)
    })

    it('keeps times past midnight above 1440', () => {
        expect(parseGtfsTime('25:10:00')).toBe(1510)
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

    const shape = (tripId: string, times: number[], stops = ['a', 'b', 'c']): TripShape => ({
        tripId,
        routeId: 'L563D99',
        directionId: 0,
        headsign: 'FOSFA',
        serviceId: '1',
        stops,
        times,
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
            [shape('t1', [360, 364, 369]), shape('t2', [420, 424], ['a', 'b'])],
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
})
