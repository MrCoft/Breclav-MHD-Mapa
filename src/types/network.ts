export type Mode = 'bus' | 'rail'

/** Seven flags, index 0 = Monday. */
export type DayMask = [number, number, number, number, number, number, number]

export interface Stop {
    id: string
    name: string
    lat: number
    lon: number
    zone?: string
    wheelchair?: boolean
    /** Originating GTFS parent-station id, for debugging. Absent in hand-authored scenarios. */
    sourceId?: string
}

export interface Line {
    id: string
    name: string
    longName: string
    mode: Mode
    color: string
    textColor: string
}

export interface Pattern {
    id: string
    line: string
    direction: 0 | 1
    headsign: string
    /** Stop ids in travel order. May repeat if the pattern loops. */
    stops: string[]
    /** Minutes from trip start, one per entry in `stops`. Same length as `stops`. */
    offsets: number[]
}

export interface Service {
    id: string
    days: DayMask
    /** Inclusive YYYY-MM-DD bounds. */
    from: string
    to: string
    /** Dates that run regardless of the day mask. */
    added?: string[]
    /** Dates that never run, overriding everything else. */
    removed?: string[]
}

export interface Trip {
    pattern: string
    service: string
    /** Minutes since midnight of the service day. May exceed 1440. */
    start: number
    /** Overrides the pattern's offsets when this trip's run times differ. */
    offsets?: number[]
}

export interface FrequencyBlock {
    pattern: string
    service: string
    from: number
    to: number
    headway: number
}

export interface Network {
    stops: Stop[]
    lines: Line[]
    patterns: Pattern[]
    services: Service[]
    trips: Trip[]
    frequencies?: FrequencyBlock[]
}

export interface Meta {
    /** Last-Modified date of the source gtfs.zip, YYYY-MM-DD. */
    feedDate: string
    generatedAt: string
    converterVersion: string
    geometrySources: { osm: number; straight: number; override: number }
}

export interface ScenarioRef {
    id: string
    label: string
}
