import type { Pattern, Trip } from '../types/network'

export interface TripTimes {
    /** Arrival minutes from the trip's start, one per stop. */
    offsets: number[]
    /** Minutes standing at each stop, or absent when the trip never waits anywhere. */
    dwells?: number[]
}

/**
 * The arrival offsets and dwells that apply to one trip.
 *
 * The two vectors are a pair and are picked from a single source: a trip that overrides `offsets`
 * overrides `dwells` with it, so a trip's arrivals can never be read against the pattern's waits.
 * Both readers — the map's vehicles and a stop's departure board — go through here rather than
 * each repeating the rule, because getting it wrong is silent: the times stay plausible and only
 * the positions and the board drift, on the subset of trips that carry an override.
 */
export function tripTimes(trip: Trip, pattern: Pattern): TripTimes {
    return trip.offsets ? { offsets: trip.offsets, dwells: trip.dwells } : pattern
}
