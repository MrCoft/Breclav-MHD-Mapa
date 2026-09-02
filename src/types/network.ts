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

/**
 * Lines carried over from another scenario unchanged rather than built from this scenario's own
 * source — e.g. the proposed network's regional lines 571 and 574, which the proposal describes
 * changing but supplies no timetable for. `note` explains why, in terms specific enough to matter
 * (see `build-proposal.ts`) — `LineBrowser` surfaces it verbatim rather than restating it.
 */
export interface InheritedLines {
    lines: string[]
    note: string
}

export interface Meta {
    /** Last-Modified date of the source gtfs.zip, YYYY-MM-DD. */
    feedDate: string
    generatedAt: string
    converterVersion: string
    geometrySources: { osm: number; routed: number; straight: number; override: number }
    inheritedLines?: InheritedLines
    /**
     * Which `current` scenario build this scenario was derived from — set only by converters
     * that read another scenario's committed output rather than an independent source (e.g.
     * the proposal reading `public/data/current/`). Lets a stale derivation be spotted by
     * comparing against `current`'s own `meta.json`, rather than assuming the two always match.
     */
    derivedFrom?: { scenarioId: string; feedDate: string; generatedAt: string }
}

export interface ScenarioRef {
    id: string
    label: string
}
