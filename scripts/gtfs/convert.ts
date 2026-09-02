import type { DayMask, Line, Mode, Pattern, Service, Trip } from '../../src/types/network'
import type { GtfsCalendarDateRow, GtfsCalendarRow, GtfsRouteRow } from './scope'

export interface TripShape {
    tripId: string
    routeId: string
    directionId: 0 | 1
    headsign: string
    serviceId: string
    /** Parent-station ids, in travel order. */
    stops: string[]
    /** Departure minutes, same length and order as `stops`. May exceed 1440. */
    times: number[]
}

/** GTFS times may exceed 24 hours; 25:10:00 means 01:10 the next morning. */
export function parseGtfsTime(value: string): number {
    const [h, m] = value.split(':')
    return Number(h) * 60 + Number(m)
}

function isoDate(yyyymmdd: string): string {
    return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`
}

export function assignLineIds(routes: Iterable<GtfsRouteRow>): Map<string, string> {
    const all = [...routes].sort((a, b) => a.route_id.localeCompare(b.route_id))
    const counts = new Map<string, number>()
    for (const r of all) {
        counts.set(r.route_short_name, (counts.get(r.route_short_name) ?? 0) + 1)
    }

    const ids = new Map<string, string>()
    for (const r of all) {
        const unique = counts.get(r.route_short_name) === 1 && r.route_short_name.length > 0
        ids.set(r.route_id, unique ? r.route_short_name : r.route_id)
    }
    return ids
}

function modeOf(routeType: string): Mode {
    // GTFS route_type 2 is rail; everything the IDS JMK feed carries otherwise is road.
    return routeType === '2' ? 'rail' : 'bus'
}

function hexColor(value: string, fallback: string): string {
    return /^[0-9A-Fa-f]{6}$/.test(value) ? `#${value.toUpperCase()}` : fallback
}

export function buildLines(routes: Iterable<GtfsRouteRow>, lineIds: Map<string, string>): Line[] {
    return [...routes]
        .map((r) => ({
            id: lineIds.get(r.route_id) ?? r.route_id,
            name: r.route_short_name || r.route_id,
            longName: r.route_long_name,
            mode: modeOf(r.route_type),
            color: hexColor(r.route_color, '#666666'),
            textColor: hexColor(r.route_text_color, '#FFFFFF'),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'cs', { numeric: true }))
}

export function buildServices(
    calendar: Iterable<GtfsCalendarRow>,
    exceptions: Iterable<GtfsCalendarDateRow>,
): Service[] {
    const byId = new Map<string, Service>()

    for (const row of calendar) {
        byId.set(row.service_id, {
            id: row.service_id,
            days: [row.monday, row.tuesday, row.wednesday, row.thursday, row.friday, row.saturday, row.sunday].map(
                Number,
            ) as DayMask,
            from: isoDate(row.start_date),
            to: isoDate(row.end_date),
        })
    }

    for (const row of exceptions) {
        let service = byId.get(row.service_id)
        if (!service) {
            // calendar_dates.txt may carry service ids absent from calendar.txt.
            service = {
                id: row.service_id,
                days: [0, 0, 0, 0, 0, 0, 0],
                from: isoDate(row.date),
                to: isoDate(row.date),
            }
            byId.set(row.service_id, service)
        }
        const date = isoDate(row.date)
        if (row.exception_type === '1') {
            ;(service.added ??= []).push(date)
        } else {
            ;(service.removed ??= []).push(date)
        }
        if (date < service.from) {
            service.from = date
        }
        if (date > service.to) {
            service.to = date
        }
    }

    return [...byId.values()]
        .map((s) => ({ ...s, added: s.added?.sort(), removed: s.removed?.sort() }))
        .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
}

/**
 * Groups trips into patterns by (line, direction, stop sequence). Each pattern
 * takes its group's most common run-time vector; trips that differ carry their
 * own. On the real feed roughly 38% of trips carry an override, so this is a
 * normal path, not a rare one.
 */
export function buildPatternsAndTrips(
    shapes: Iterable<TripShape>,
    lineIds: Map<string, string>,
): { patterns: Pattern[]; trips: Trip[] } {
    interface Entry {
        start: number
        offsets: number[]
        service: string
    }

    interface Group {
        lineId: string
        direction: 0 | 1
        headsign: string
        stops: string[]
        entries: Entry[]
    }

    const groups = new Map<string, Group>()

    for (const shape of shapes) {
        const lineId = lineIds.get(shape.routeId) ?? shape.routeId
        const key = `${lineId}|${shape.directionId}|${shape.stops.join('>')}`
        const start = shape.times[0]!
        const offsets = shape.times.map((t) => t - start)

        const entry: Entry = { start, offsets, service: shape.serviceId }
        const group = groups.get(key)
        if (group) {
            group.entries.push(entry)
        } else {
            groups.set(key, {
                lineId,
                direction: shape.directionId,
                headsign: shape.headsign,
                stops: shape.stops,
                entries: [entry],
            })
        }
    }

    // Sorting the group keys makes pattern numbering stable across runs.
    const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
    const counters = new Map<string, number>()
    const patterns: Pattern[] = []
    const trips: Trip[] = []

    for (const [, group] of ordered) {
        const prefix = `${group.lineId}-${group.direction}`
        const n = (counters.get(prefix) ?? 0) + 1
        counters.set(prefix, n)
        const patternId = `${prefix}-${n}`

        const tally = new Map<string, number>()
        for (const entry of group.entries) {
            const k = entry.offsets.join(',')
            tally.set(k, (tally.get(k) ?? 0) + 1)
        }
        const modalKey = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0]
        const modal = modalKey.split(',').map(Number)

        patterns.push({
            id: patternId,
            line: group.lineId,
            direction: group.direction,
            headsign: group.headsign,
            stops: group.stops,
            offsets: modal,
        })

        const sorted = group.entries.sort((a, b) => a.start - b.start || a.service.localeCompare(b.service))
        for (const entry of sorted) {
            const same = entry.offsets.join(',') === modalKey
            trips.push(
                same
                    ? { pattern: patternId, service: entry.service, start: entry.start }
                    : { pattern: patternId, service: entry.service, start: entry.start, offsets: entry.offsets },
            )
        }
    }

    return { patterns, trips }
}
