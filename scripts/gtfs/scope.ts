export interface GtfsStopRow {
    stop_id: string
    stop_name: string
    stop_lat: string
    stop_lon: string
    zone_id: string
    location_type: string
    parent_station: string
    wheelchair_boarding: string
    platform_code: string
}

export interface GtfsRouteRow {
    route_id: string
    route_short_name: string
    route_long_name: string
    route_type: string
    route_color: string
    route_text_color: string
}

export interface GtfsTripRow {
    route_id: string
    service_id: string
    trip_id: string
    trip_headsign: string
    direction_id: string
}

export interface GtfsStopTimeRow {
    trip_id: string
    stop_id: string
    stop_sequence: string
    arrival_time: string
    departure_time: string
}

export interface GtfsCalendarRow {
    service_id: string
    monday: string
    tuesday: string
    wednesday: string
    thursday: string
    friday: string
    saturday: string
    sunday: string
    start_date: string
    end_date: string
}

export interface GtfsCalendarDateRow {
    service_id: string
    date: string
    exception_type: string
}

export function municipalityOf(stopName: string): string {
    const [first] = stopName.split(',')
    return (first ?? '').trim()
}

/** Every stop id — platform or station — mapped to the station it belongs to. */
export function buildParentMap(rows: Iterable<GtfsStopRow>): Map<string, string> {
    const parents = new Map<string, string>()
    for (const row of rows) {
        parents.set(row.stop_id, row.parent_station || row.stop_id)
    }
    return parents
}

export function slugify(name: string): string {
    return name
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

/**
 * Readable ids for stations. Sorted by GTFS id first so that a slug collision
 * always resolves the same way across runs.
 */
export function assignStopIds(stations: Iterable<GtfsStopRow>): Map<string, string> {
    const sorted = [...stations].sort((a, b) => a.stop_id.localeCompare(b.stop_id))
    const used = new Map<string, number>()
    const ids = new Map<string, string>()

    for (const station of sorted) {
        const base = slugify(station.stop_name) || 'stop'
        const seen = used.get(base) ?? 0
        used.set(base, seen + 1)
        ids.set(station.stop_id, seen === 0 ? base : `${base}-${seen + 1}`)
    }
    return ids
}
