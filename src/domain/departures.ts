import { previousDate, servicesOnDate } from './calendar'
import type { NetworkIndex } from '../data/buildIndex'

export interface Departure {
    patternId: string
    lineId: string
    lineName: string
    headsign: string
    /** Minutes from midnight of the queried date. Always < 1440. */
    time: number
    /** The service day the trip belongs to, which may be the previous date. */
    serviceDate: string
}

/**
 * Departures from `stopId` at or after `fromMinutes` on `date`.
 *
 * Two service days are considered. A trip on the previous service day with a
 * time of 1460 departs at 00:20 on `date`, so its time is shifted by -1440.
 * Trips on the previous day that ran before midnight land on negative times
 * and fall out of the `time < fromMinutes` filter.
 */
export function departuresAt(
    index: NetworkIndex,
    stopId: string,
    date: string,
    fromMinutes: number,
    limit = 12,
): Departure[] {
    const positions = index.patternsByStop.get(stopId)
    if (!positions || positions.length === 0) {
        return []
    }

    const days: { serviceDate: string; shift: number }[] = [
        { serviceDate: previousDate(date), shift: 1440 },
        { serviceDate: date, shift: 0 },
    ]

    const found: Departure[] = []
    for (const { serviceDate, shift } of days) {
        const active = servicesOnDate(index.services, serviceDate)
        if (active.size === 0) {
            continue
        }

        for (const { pattern, index: stopIndex } of positions) {
            const line = index.lines.get(pattern.line)
            if (!line) {
                continue
            }
            const trips = index.tripsByPattern.get(pattern.id) ?? []

            for (const trip of trips) {
                if (!active.has(trip.service)) {
                    continue
                }
                const offsets = trip.offsets ?? pattern.offsets
                const offset = offsets[stopIndex]
                if (offset === undefined) {
                    continue
                }
                const time = trip.start + offset - shift
                if (time < fromMinutes || time >= 1440) {
                    continue
                }
                found.push({
                    patternId: pattern.id,
                    lineId: line.id,
                    lineName: line.name,
                    headsign: pattern.headsign,
                    time,
                    serviceDate,
                })
            }
        }
    }

    found.sort((a, b) => a.time - b.time)
    return found.slice(0, limit)
}
