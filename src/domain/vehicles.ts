import { previousDate, servicesOnDate } from './calendar'
import { positionAt } from './patternGeometry'
import type { PatternGeometry } from './patternGeometry'
import type { NetworkIndex } from '../data/buildIndex'
import type { Line, Pattern, Trip } from '../types/network'

export interface VehicleMotionOptions {
    /** Seconds a vehicle sits at a stop before departing, before the `dwellFraction` clamp. */
    dwellSeconds: number
    /** Upper bound on dwell, as a fraction of the segment's total scheduled time. */
    dwellFraction: number
    /** Acceleration and deceleration rate while moving between stops, in metres per second squared. */
    accelMetresPerSecond2: number
}

export const DEFAULT_VEHICLE_MOTION_OPTIONS: VehicleMotionOptions = {
    dwellSeconds: 25,
    dwellFraction: 0.4,
    accelMetresPerSecond2: 1,
}

export interface Vehicle {
    /** Stable across frames for the same trip, derived from pattern id, service id and start. */
    tripKey: string
    patternId: string
    lineId: string
    lineName: string
    headsign: string
    lon: number
    lat: number
    bearing: number
    /** True while the vehicle is dwelling at a stop rather than moving between two. */
    atStop: boolean
}

/** Index `i` such that `offsets[i] <= relativeMinutes < offsets[i + 1]`, or undefined if none. */
function segmentIndexFor(offsets: number[], relativeMinutes: number): number | undefined {
    for (let i = 0; i < offsets.length - 1; i += 1) {
        const end = offsets[i + 1]
        if (end !== undefined && relativeMinutes < end) {
            return i
        }
    }
    return undefined
}

/**
 * Metres travelled `seconds` into a `duration`-second acceleration/cruise/deceleration profile
 * that covers `distance`, accelerating and decelerating at `accel`.
 *
 * Solves the cruise speed `v` from the trapezoid's area equalling `distance`:
 * `distance = v * duration - v^2 / accel`, taking the smaller root of the resulting quadratic.
 * When `distance` is small enough that `v` never reaches the point of a cruise phase, the same
 * formula still yields a `v` that produces a triangular (accelerate-then-decelerate) profile
 * that arrives exactly at `distance` — no separate case is needed. When the discriminant is
 * negative, `distance` cannot be covered in `duration` at this acceleration at all (a common
 * mismatch between a routed distance and a minute-rounded timetable); this falls back to linear
 * interpolation across `duration` rather than producing `NaN`.
 */
function trapezoidDistance(seconds: number, duration: number, distance: number, accel: number): number {
    if (duration <= 0) {
        return distance
    }
    if (accel <= 0) {
        return distance * (seconds / duration)
    }

    const discriminant = (accel * duration) ** 2 - 4 * accel * distance
    if (discriminant < 0) {
        return distance * (seconds / duration)
    }

    const cruise = (accel * duration - Math.sqrt(discriminant)) / 2
    const accelTime = cruise / accel
    const decelStart = duration - accelTime

    if (seconds <= accelTime) {
        return 0.5 * accel * seconds * seconds
    }
    if (seconds >= decelStart) {
        const remaining = duration - seconds
        return distance - 0.5 * accel * remaining * remaining
    }
    return (cruise * cruise) / (2 * accel) + cruise * (seconds - accelTime)
}

function vehicleForTrip(
    trip: Trip,
    pattern: Pattern,
    line: Line,
    geometry: PatternGeometry,
    clockMinutes: number,
    options: VehicleMotionOptions,
): Vehicle | null {
    const offsets = trip.offsets ?? pattern.offsets
    const first = offsets[0]
    const last = offsets[offsets.length - 1]
    if (first === undefined || last === undefined || offsets.length !== geometry.stopDistances.length) {
        return null
    }

    const windowStart = trip.start + first
    const windowEnd = trip.start + last
    if (clockMinutes < windowStart || clockMinutes >= windowEnd) {
        return null
    }

    const relativeMinutes = clockMinutes - trip.start
    const segIndex = segmentIndexFor(offsets, relativeMinutes)
    if (segIndex === undefined) {
        return null
    }

    const segStartOffset = offsets[segIndex]
    const segEndOffset = offsets[segIndex + 1]
    const segStartDistance = geometry.stopDistances[segIndex]
    const segEndDistance = geometry.stopDistances[segIndex + 1]
    if (
        segStartOffset === undefined ||
        segEndOffset === undefined ||
        segStartDistance === undefined ||
        segEndDistance === undefined
    ) {
        return null
    }

    const segmentSeconds = (segEndOffset - segStartOffset) * 60
    const elapsedSeconds = (relativeMinutes - segStartOffset) * 60
    const dwell = Math.min(options.dwellSeconds, options.dwellFraction * segmentSeconds)
    const atStop = elapsedSeconds < dwell

    const distanceInSegment = atStop
        ? 0
        : trapezoidDistance(
              elapsedSeconds - dwell,
              segmentSeconds - dwell,
              segEndDistance - segStartDistance,
              options.accelMetresPerSecond2,
          )

    const { lon, lat, bearing } = positionAt(geometry, segStartDistance + distanceInSegment)

    return {
        tripKey: `${trip.pattern}:${trip.service}:${trip.start}`,
        patternId: pattern.id,
        lineId: line.id,
        lineName: line.name,
        headsign: pattern.headsign,
        lon,
        lat,
        bearing,
        atStop,
    }
}

/**
 * Every vehicle running at `minutes` (fractional minutes since midnight of `date`) on `date`.
 *
 * Considers both `date`'s own service day and the previous one shifted by 1440 minutes, the same
 * two-service-day logic `departuresAt` uses, so a trip that starts before midnight and runs past
 * it is still found early the next morning.
 */
export function vehiclesAt(
    index: NetworkIndex,
    geometries: ReadonlyMap<string, PatternGeometry>,
    date: string,
    minutes: number,
    options?: Partial<VehicleMotionOptions>,
): Vehicle[] {
    const opts: VehicleMotionOptions = { ...DEFAULT_VEHICLE_MOTION_OPTIONS, ...options }

    const dayGroups: { serviceDate: string; shift: number }[] = [
        { serviceDate: previousDate(date), shift: 1440 },
        { serviceDate: date, shift: 0 },
    ]

    const vehicles: Vehicle[] = []
    for (const { serviceDate, shift } of dayGroups) {
        const activeServices = servicesOnDate(index.services, serviceDate)
        if (activeServices.size === 0) {
            continue
        }
        const clockMinutes = minutes + shift

        for (const pattern of index.patterns.values()) {
            const geometry = geometries.get(pattern.id)
            if (!geometry) {
                continue
            }
            const line = index.lines.get(pattern.line)
            if (!line) {
                continue
            }

            const trips = index.tripsByPattern.get(pattern.id) ?? []
            for (const trip of trips) {
                if (!activeServices.has(trip.service)) {
                    continue
                }
                const vehicle = vehicleForTrip(trip, pattern, line, geometry, clockMinutes, opts)
                if (vehicle) {
                    vehicles.push(vehicle)
                }
            }
        }
    }

    return vehicles
}
