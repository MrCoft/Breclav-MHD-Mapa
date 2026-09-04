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
    /**
     * Arrival minutes, same length and order as `stops`. May exceed 1440. Per decision 32 the
     * first entry is the departure from the origin rather than an arrival; every later one is a
     * true arrival, including the terminus.
     */
    arrivals: number[]
    /**
     * Whole minutes standing at each stop, same length and order as `stops`. Departure from stop
     * `i` is `arrivals[i] + dwells[i]`. The first and last entries are always 0 — see `tripTiming`.
     */
    dwells: number[]
}

/** GTFS times may exceed 24 hours; 25:10:00 means 01:10 the next morning. */
export function parseGtfsTime(value: string): number {
    const [h, m] = value.split(':')
    return Number(h) * 60 + Number(m)
}

/** One stop of one trip, as the feed gives it: both clock times, in minutes. */
export interface StopVisit {
    stop: string
    arrival: number
    departure: number
}

/**
 * Decision 32's three importer rules, applied to one trip's stops in travel order: the first
 * stop's offset is its *departure*, every later stop's is its *arrival*, and the dwell is the wait
 * between the two — forced to 0 at both ends, so neither the wait before a trip starts nor the
 * operator's layover after it ends is ever drawn. Dropping that layover is the whole point: the
 * feed's departure at a terminus is the vehicle's next duty, hours later.
 *
 * A departure before its own arrival never occurs in this feed and cannot be interpreted, so it
 * throws rather than clamping — clamping would bury exactly the kind of feed fault that went
 * unnoticed for as long as this function's absence did (known bug 6).
 */
export function tripTiming(tripId: string, visits: StopVisit[]): { arrivals: number[]; dwells: number[] } {
    const arrivals: number[] = []
    const dwells: number[] = []

    for (const [i, visit] of visits.entries()) {
        if (visit.departure < visit.arrival) {
            throw new Error(
                `Trip ${tripId} at stop ${visit.stop}: departure minute ${visit.departure} is before arrival minute ${visit.arrival}`,
            )
        }
        const atEnd = i === 0 || i === visits.length - 1
        arrivals.push(i === 0 ? visit.departure : visit.arrival)
        dwells.push(atEnd ? 0 : visit.departure - visit.arrival)
    }

    return { arrivals, dwells }
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

/** Omitted from the shipped network when nothing stands anywhere, which is most patterns. */
function dwellsIfAny(dwells: number[]): number[] | undefined {
    return dwells.some((d) => d !== 0) ? dwells : undefined
}

/**
 * Groups trips into patterns by (line, direction, stop sequence). Each pattern
 * takes its group's most common run-time vector; trips that differ carry their
 * own. On the real feed roughly 38% of trips carry an override, so this is a
 * normal path, not a rare one.
 *
 * "Most common" tallies offsets and dwells together, and an overriding trip carries both or
 * neither, because the two are read as a pair: a trip's `offsets` are never applied to the
 * pattern's `dwells` (see `src/types/network.ts`), so two trips that agree on run times and
 * disagree on where they wait are two different timings, not one.
 */
export function buildPatternsAndTrips(
    shapes: Iterable<TripShape>,
    lineIds: Map<string, string>,
): { patterns: Pattern[]; trips: Trip[] } {
    interface Entry {
        start: number
        offsets: number[]
        dwells: number[]
        service: string
    }

    interface Group {
        lineId: string
        direction: 0 | 1
        headsign: string
        stops: string[]
        entries: Entry[]
    }

    const timingKey = (entry: Entry): string => `${entry.offsets.join(',')}|${entry.dwells.join(',')}`

    const groups = new Map<string, Group>()

    for (const shape of shapes) {
        const lineId = lineIds.get(shape.routeId) ?? shape.routeId
        const key = `${lineId}|${shape.directionId}|${shape.stops.join('>')}`
        const start = shape.arrivals[0]!
        const offsets = shape.arrivals.map((t) => t - start)

        const entry: Entry = { start, offsets, dwells: shape.dwells, service: shape.serviceId }
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

        const tally = new Map<string, { count: number; entry: Entry }>()
        for (const entry of group.entries) {
            const k = timingKey(entry)
            const tallied = tally.get(k)
            if (tallied) {
                tallied.count += 1
            } else {
                tally.set(k, { count: 1, entry })
            }
        }
        const [modalKey, modal] = [...tally.entries()].sort(
            (a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]),
        )[0]!
        const modalDwells = dwellsIfAny(modal.entry.dwells)

        patterns.push({
            id: patternId,
            line: group.lineId,
            direction: group.direction,
            headsign: group.headsign,
            stops: group.stops,
            offsets: modal.entry.offsets,
            ...(modalDwells && { dwells: modalDwells }),
        })

        const sorted = group.entries.sort((a, b) => a.start - b.start || a.service.localeCompare(b.service))
        for (const entry of sorted) {
            if (timingKey(entry) === modalKey) {
                trips.push({ pattern: patternId, service: entry.service, start: entry.start })
                continue
            }
            const dwells = dwellsIfAny(entry.dwells)
            trips.push({
                pattern: patternId,
                service: entry.service,
                start: entry.start,
                offsets: entry.offsets,
                ...(dwells && { dwells }),
            })
        }
    }

    return { patterns, trips }
}
