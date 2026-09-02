import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateNetwork } from '../src/data/validate'
import { assignLineIds, buildLines, buildPatternsAndTrips, buildServices, parseGtfsTime } from './gtfs/convert'
import { downloadFeed, extractEntries, loadScope, streamCsv } from './gtfs/read'
import { assignStopIds, buildParentMap, municipalityOf } from './gtfs/scope'
import { cumulativeDistances, matchPatternGeometry, remeasureSimplified, straightLine } from './osm/match'
import { fetchRoutes } from './osm/overpass'
import { buildRailGraph, fetchRailways } from './osm/railGraph'
import { routePattern } from './osm/routePattern'
import { simplifyIndices } from './osm/simplify'
import { relationToLine } from './osm/stitch'
import type { PatternRouter, Position, RelationLine } from './osm/match'
import type {
    GtfsCalendarDateRow,
    GtfsCalendarRow,
    GtfsRouteRow,
    GtfsStopRow,
    GtfsStopTimeRow,
    GtfsTripRow,
} from './gtfs/scope'
import type { ScopeConfig } from './gtfs/read'
import type { TripShape } from './gtfs/convert'
import type { Meta, Network, Stop } from '../src/types/network'
import type { OsmNode, OsmRelation, OsmWay } from './osm/overpass'
import type { RailGraph } from './osm/railGraph'

export const CONVERTER_VERSION = '1.0.0'

export interface GeometryFeature {
    type: 'Feature'
    properties: {
        patternId: string
        lineId: string
        lineName: string
        mode: string
        color: string
        source: string
        stopDistances: number[]
    }
    geometry: { type: 'LineString'; coordinates: Position[] }
}

/**
 * Per-pattern signals from `remeasureSimplified` that never reach the shipped GeoJSON — kept
 * out of `GeometryFeature.properties` because they are a build-time correctness signal, not
 * data the client has any use for. Threaded separately into `assertGeometrySane` instead.
 */
export interface GeometryDiagnostics {
    patternId: string
    /** Worst perpendicular distance between a stop and its projected point on the simplified line. */
    maxOffMetres: number
    /** Worst amount `remeasureSimplified`'s monotonicity floor had to correct — see its own doc comment. */
    maxClampMetres: number
}

// How far a pattern's final stopDistance may sit from its simplified line's own length.
// Simplification legitimately shortens a line by cutting corners — observed up to ~11m even on
// this dataset's longest route (115km of rail) — so this must clear that, but a genuine bug
// (a stop re-projected onto the wrong part of a self-proximate line) misses by hundreds of
// metres at minimum, so 20m keeps a wide margin on both sides.
const GEOMETRY_LENGTH_TOLERANCE_METRES = 20

// How far a stop's projection onto the simplified line may sit from the stop itself.
//
// Bus stops sit close to their route (a handful of metres at most, on this dataset), but rail
// stops do not: routeOnRailGraph (railGraph.ts) already snaps a stop to the nearest track node
// at up to 500m — its own maxSnapMetres — because a station's GTFS coordinate is often the
// platform or entrance, not track centreline, and because a rail pattern's own endpoint can be a
// non-rail stop entirely (S8-0-1 ends at "Břeclav, autobusové nádraží", the bus station, routed
// via the rail graph regardless). Measured on this dataset's actual 252 patterns, the worst is
// 220.8m (several S8/S9/R13 patterns) — legitimate, present in the tier's own match before this
// task's simplification ever runs, not something simplification introduced. So this gate has to
// clear the most permissive tier's own ceiling, not "a few metres": 500m (railGraph's
// maxSnapMetres) + 2m (the simplification tolerance itself, config/scope.json) + 18m margin for
// the window search's own approximation = 520m. Still an order of magnitude below the
// hundreds-of-metres to kilometres a window that matched an unrelated part of a long route would
// produce, so it stays a meaningful gate rather than a rubber stamp.
const MAX_OFF_TOLERANCE_METRES = 520

// How much `remeasureSimplified`'s non-decreasing floor may ever have had to correct. A correct
// window search never needs the floor — it is pure IEEE-754 slack (haversine round-trip error
// on repeated additions), which never approaches a whole metre. Any real backward jump, the bug
// this task fixed, is a metre-plus at minimum, so 1cm cleanly separates "floating point" from
// "the floor did real work."
const MAX_CLAMP_TOLERANCE_METRES = 0.01

/**
 * Confirms `stopDistances` was actually recomputed against the geometry that ships, not left
 * over from before simplification, and — the part that actually exercises `remeasureSimplified`'s
 * own logic rather than the arithmetic `build-network.ts` wraps around it — that the projection
 * search it performed was trustworthy stop by stop, not just at the ends.
 *
 * `stopDistances[0] === 0` and "each stop is no closer to the start than the one before it" are
 * checked below, but by the time a `GeometryFeature` reaches this function both are guaranteed by
 * construction: `stopDistances[0]` is always `along[0] - along[0]`, and `remeasureSimplified`
 * itself floors every value at the previous one before returning. Kept as basic structural
 * documentation of the shipped contract, but neither can actually fail here, so they cannot be
 * the whole check. `maxClampMetres` and `maxOffMetres` are: the former is the *pre-clamp* signal
 * — how far a raw, unfloored projection would have fallen behind the previous stop, which is
 * exactly the interior backward jump this task's original bug produced (a mid-route stop
 * re-projected onto the wrong pass of a self-proximate line) and which the floor would otherwise
 * absorb into a merely-flat pair of values instead of a visible failure. The latter is the offset
 * between a stop and where it landed on the line, which a mismatched search window inflates by
 * orders of magnitude over a correct one.
 */
export function assertGeometrySane(features: GeometryFeature[], diagnostics: GeometryDiagnostics[]): void {
    const problems: string[] = []

    for (const feature of features) {
        const { patternId, stopDistances } = feature.properties
        const coords = feature.geometry.coordinates
        const lineLength = cumulativeDistances(coords).at(-1) ?? 0

        if (stopDistances[0] !== 0) {
            problems.push(`${patternId}: stopDistances[0] = ${stopDistances[0]}, expected 0`)
        }
        for (let i = 1; i < stopDistances.length; i += 1) {
            if (stopDistances[i]! < stopDistances[i - 1]!) {
                problems.push(
                    `${patternId}: stopDistances not monotonic at index ${i} (${stopDistances[i - 1]} -> ${stopDistances[i]})`,
                )
            }
        }
        const last = stopDistances.at(-1)
        if (last !== undefined && Math.abs(last - lineLength) > GEOMETRY_LENGTH_TOLERANCE_METRES) {
            problems.push(
                `${patternId}: final stopDistance ${last.toFixed(1)}m is ${Math.abs(last - lineLength).toFixed(1)}m from the line's own length ${lineLength.toFixed(1)}m`,
            )
        }
    }

    for (const { patternId, maxOffMetres, maxClampMetres } of diagnostics) {
        if (maxClampMetres > MAX_CLAMP_TOLERANCE_METRES) {
            problems.push(
                `${patternId}: remeasureSimplified's monotonicity floor corrected ${maxClampMetres.toFixed(2)}m — ` +
                    `a stop's raw (pre-clamp) projection fell behind the previous stop's, the interior-backward-jump ` +
                    `bug this task fixed, silently absorbed instead of surfaced`,
            )
        }
        if (maxOffMetres > MAX_OFF_TOLERANCE_METRES) {
            problems.push(
                `${patternId}: a stop sits ${maxOffMetres.toFixed(1)}m from its projected point on the simplified ` +
                    `line — likely a search window that matched the wrong part of a self-proximate route`,
            )
        }
    }

    if (problems.length > 0) {
        throw new Error(`Geometry sanity check failed:\n${problems.join('\n')}`)
    }
}

export function assertSane(net: Network, scope: ScopeConfig): void {
    const problems: string[] = []

    if (net.lines.length < scope.expectedRoutes.min || net.lines.length > scope.expectedRoutes.max) {
        problems.push(
            `lines: ${net.lines.length} outside expected ${scope.expectedRoutes.min}..${scope.expectedRoutes.max}`,
        )
    }
    if (net.trips.length === 0) {
        problems.push('trips: none produced')
    }
    if (net.patterns.some((p) => p.stops.length < 2)) {
        problems.push('patterns: at least one has fewer than 2 stops')
    }

    const served = new Set(net.patterns.flatMap((p) => p.stops))
    for (const stop of net.stops) {
        if (!served.has(stop.id)) {
            problems.push(`stop ${stop.id} is served by no pattern`)
        }
    }

    if (problems.length > 0) {
        throw new Error(`Sanity check failed:\n${problems.join('\n')}`)
    }
}

function sortNetwork(net: Network): Network {
    return {
        stops: [...net.stops].sort((a, b) => a.id.localeCompare(b.id)),
        lines: [...net.lines].sort((a, b) => a.id.localeCompare(b.id, 'cs', { numeric: true })),
        patterns: [...net.patterns].sort((a, b) => a.id.localeCompare(b.id, 'cs', { numeric: true })),
        services: [...net.services].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })),
        trips: [...net.trips].sort(
            (a, b) =>
                a.pattern.localeCompare(b.pattern, 'cs', { numeric: true }) ||
                a.start - b.start ||
                a.service.localeCompare(b.service),
        ),
    }
}

async function main(): Promise<void> {
    const refreshOsm = process.argv.includes('--refresh-osm')
    const refreshRouting = process.argv.includes('--refresh-routing')
    const scope = loadScope()
    const cacheDir = 'data/cache/gtfs'
    const outDir = 'public/data/current'

    console.log('Downloading feed…')
    const { zipPath, feedDate } = await downloadFeed(scope.feedUrl, cacheDir)
    await extractEntries(zipPath, cacheDir, [
        'stops.txt',
        'routes.txt',
        'trips.txt',
        'stop_times.txt',
        'calendar.txt',
        'calendar_dates.txt',
    ])

    const stopRows: GtfsStopRow[] = []
    await streamCsv<GtfsStopRow>(join(cacheDir, 'stops.txt'), (r) => stopRows.push(r))
    const parents = buildParentMap(stopRows)
    const stationRows = stopRows.filter((r) => (r.parent_station || r.stop_id) === r.stop_id)

    const routeRows: GtfsRouteRow[] = []
    await streamCsv<GtfsRouteRow>(join(cacheDir, 'routes.txt'), (r) => routeRows.push(r))

    const tripRows = new Map<string, GtfsTripRow>()
    await streamCsv<GtfsTripRow>(join(cacheDir, 'trips.txt'), (r) => tripRows.set(r.trip_id, r))

    // Pass 1: collect each trip's stop sequence, in parent-station ids.
    console.log('Reading stop_times…')
    const sequences = new Map<string, { seq: number; station: string; minutes: number }[]>()
    await streamCsv<GtfsStopTimeRow>(join(cacheDir, 'stop_times.txt'), (r) => {
        const station = parents.get(r.stop_id) ?? r.stop_id
        const list = sequences.get(r.trip_id)
        const entry = { seq: Number(r.stop_sequence), station, minutes: parseGtfsTime(r.departure_time) }
        if (list) {
            list.push(entry)
        } else {
            sequences.set(r.trip_id, [entry])
        }
    })
    for (const list of sequences.values()) {
        list.sort((a, b) => a.seq - b.seq)
    }

    // Pass 2: routes touching Břeclav, then every trip of those routes.
    const breclavStations = new Set(
        stationRows.filter((r) => municipalityOf(r.stop_name) === scope.municipality).map((r) => r.stop_id),
    )
    const routeIds = new Set<string>()
    for (const [tripId, list] of sequences) {
        if (!list.some((e) => breclavStations.has(e.station))) {
            continue
        }
        const trip = tripRows.get(tripId)
        if (trip) {
            routeIds.add(trip.route_id)
        }
    }

    const selectedRoutes = routeRows.filter((r) => routeIds.has(r.route_id))
    const lineIds = assignLineIds(selectedRoutes)

    const shapes: TripShape[] = []
    const usedStations = new Set<string>()
    for (const [tripId, list] of sequences) {
        const trip = tripRows.get(tripId)
        if (!trip || !routeIds.has(trip.route_id)) {
            continue
        }
        for (const e of list) {
            usedStations.add(e.station)
        }
        shapes.push({
            tripId,
            routeId: trip.route_id,
            directionId: trip.direction_id === '1' ? 1 : 0,
            headsign: trip.trip_headsign,
            serviceId: trip.service_id,
            stops: list.map((e) => e.station),
            times: list.map((e) => e.minutes),
        })
    }

    const stationById = new Map(stationRows.map((r) => [r.stop_id, r]))
    const childOf = new Map<string, GtfsStopRow>()
    for (const r of stopRows) {
        const parent = r.parent_station || r.stop_id
        if (!childOf.has(parent)) {
            childOf.set(parent, r)
        }
    }

    const stopIds = assignStopIds(
        [...usedStations].map((id) => stationById.get(id)).filter((r): r is GtfsStopRow => !!r),
    )
    const stops: Stop[] = [...usedStations]
        .map((id): Stop | null => {
            const station = stationById.get(id)
            if (!station) {
                return null
            }
            const child = childOf.get(id) ?? station
            return {
                id: stopIds.get(id)!,
                name: station.stop_name,
                lat: Number(station.stop_lat),
                lon: Number(station.stop_lon),
                zone: child.zone_id || undefined,
                wheelchair: child.wheelchair_boarding === '1' ? true : undefined,
                sourceId: id,
            }
        })
        .filter((s): s is Stop => s !== null)

    // Re-key trip shapes from GTFS station ids to the readable slugs.
    for (const shape of shapes) {
        shape.stops = shape.stops.map((id) => stopIds.get(id) ?? id)
    }

    const calendarRows: GtfsCalendarRow[] = []
    await streamCsv<GtfsCalendarRow>(join(cacheDir, 'calendar.txt'), (r) => calendarRows.push(r))
    const calendarDateRows: GtfsCalendarDateRow[] = []
    await streamCsv<GtfsCalendarDateRow>(join(cacheDir, 'calendar_dates.txt'), (r) => calendarDateRows.push(r))

    const usedServices = new Set(shapes.map((s) => s.serviceId))
    const services = buildServices(
        calendarRows.filter((r) => usedServices.has(r.service_id)),
        calendarDateRows.filter((r) => usedServices.has(r.service_id)),
    )

    const { patterns, trips } = buildPatternsAndTrips(shapes, lineIds)
    const network = sortNetwork({ stops, lines: buildLines(selectedRoutes, lineIds), patterns, services, trips })

    validateNetwork(network)
    assertSane(network, scope)

    console.log('Fetching OSM geometry…')
    const osm = await fetchRoutes(scope, { refresh: refreshOsm })
    const relations = osm.elements.filter((e): e is OsmRelation => e.type === 'relation')
    const ways = osm.elements.filter((e): e is OsmWay => e.type === 'way')
    const nodes = osm.elements.filter((e): e is OsmNode => e.type === 'node')
    const relationLines: RelationLine[] = relations
        .map((r) => ({ ref: r.tags.ref ?? '', coordinates: relationToLine(r, ways, nodes) }))
        .filter((r) => r.ref !== '' && r.coordinates.length >= 2)

    // The rail graph needs its own Overpass query and is only worth fetching if some rail
    // pattern actually reaches tier 3 (no relation covers it). Built at most once per run.
    let railGraphPromise: Promise<RailGraph> | null = null
    const getRailGraph = (): Promise<RailGraph> => {
        if (!railGraphPromise) {
            railGraphPromise = (async () => {
                console.log('Fetching OSM railways…')
                const railways = await fetchRailways(scope, { refresh: refreshRouting })
                const railWays = railways.elements.filter((e): e is OsmWay => e.type === 'way')
                const railNodes = railways.elements.filter((e): e is OsmNode => e.type === 'node')
                return buildRailGraph(railWays, railNodes)
            })()
        }
        return railGraphPromise
    }

    // Tier 3: road routing for buses via OSRM, rail-graph Dijkstra for trains. Patterns are
    // routed one at a time, in a plain loop rather than Promise.all, so OSRM — a free
    // community server — only ever sees one request in flight at a time.
    const router: PatternRouter = async (pattern, stopCoords) => {
        const line = network.lines.find((l) => l.id === pattern.line)!
        if (line.mode === 'rail') {
            const railGraph = await getRailGraph()
            return routePattern(pattern, stopCoords, { mode: 'rail', railGraph, refresh: refreshRouting })
        }
        return routePattern(pattern, stopCoords, { mode: 'bus', refresh: refreshRouting })
    }

    const stopById = new Map(network.stops.map((s) => [s.id, s]))
    const counts = { osm: 0, routed: 0, straight: 0, override: 0 }
    const features: GeometryFeature[] = []
    const geometryDiagnostics: GeometryDiagnostics[] = []
    for (const pattern of network.patterns) {
        const overridePath = join('data/geometry-overrides', `${pattern.id}.geojson`)
        let override: Position[] | undefined
        if (existsSync(overridePath)) {
            const parsed = JSON.parse(readFileSync(overridePath, 'utf8')) as {
                geometry?: { coordinates?: Position[] }
                coordinates?: Position[]
            }
            override = parsed.geometry?.coordinates ?? parsed.coordinates
        }

        const line = network.lines.find((l) => l.id === pattern.line)!
        const {
            coordinates,
            stopDistances: originalStopDistances,
            source,
        } = await matchPatternGeometry({
            pattern,
            stops: stopById,
            relations: relationLines,
            override,
            router,
        })
        counts[source] += 1

        // Simplify only after the geometry tier has resolved, then recompute stopDistances
        // from scratch by re-projecting each stop onto the simplified line — see
        // remeasureSimplified's own doc comment for why that re-projection has to be windowed
        // by the tier's original (dense-line) distances rather than searched fresh and
        // unguided. Scaling the old distances proportionally, the obvious alternative, would be
        // wrong wherever simplification removes vertices unevenly along the route; the original
        // values are used only to place the search, never as the answer.
        const keptIndices = simplifyIndices(coordinates, scope.geometrySimplifyMetres)
        const simplified = keptIndices.map((i) => coordinates[i]!)
        const stopCoords = straightLine(pattern, stopById)
        const { along, maxOffMetres, maxClampMetres } = remeasureSimplified({
            originalCoordinates: coordinates,
            originalStopDistances,
            simplifiedCoordinates: simplified,
            keptIndices,
            stopCoords,
        })
        geometryDiagnostics.push({ patternId: pattern.id, maxOffMetres, maxClampMetres })
        const origin = along[0] ?? 0
        const stopDistances = along.map((a) => Math.max(0, a - origin))

        features.push({
            type: 'Feature' as const,
            properties: {
                patternId: pattern.id,
                lineId: line.id,
                lineName: line.name,
                mode: line.mode,
                color: line.color,
                source,
                stopDistances,
            },
            geometry: { type: 'LineString' as const, coordinates: simplified },
        })
    }

    assertGeometrySane(features, geometryDiagnostics)

    const meta: Meta = {
        feedDate,
        generatedAt: new Date().toISOString(),
        converterVersion: CONVERTER_VERSION,
        geometrySources: counts,
    }

    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'network.json'), `${JSON.stringify(network, null, 1)}\n`, 'utf8')
    // Unindented, unlike the other two files: pretty-printing puts every coordinate number on
    // its own line, which was already too sparse to meaningfully review or diff for a file this
    // size — and indentation alone was costing roughly a third of gzip's achievable compression
    // on exactly the payload this converter exists to shrink. See task 23's report for the
    // measured effect.
    writeFileSync(
        join(outDir, 'geometry.geojson'),
        `${JSON.stringify({ type: 'FeatureCollection', features })}\n`,
        'utf8',
    )
    writeFileSync(join(outDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')

    console.log(
        `Feed ${feedDate}: ${network.lines.length} lines, ${network.stops.length} stops, ${network.patterns.length} patterns, ${network.trips.length} trips`,
    )
    console.log(
        `Geometry: ${counts.osm} from OSM relations, ${counts.routed} routed, ${counts.override} overridden, ${counts.straight} straight-line fallbacks`,
    )
    if (counts.straight > 0) {
        const fallbacks = features.filter((f) => f.properties.source === 'straight').map((f) => f.properties.patternId)
        console.log(`Fallback patterns (override worklist): ${fallbacks.join(', ')}`)
    }
}

if (process.argv[1]?.endsWith('build-network.ts')) {
    main().catch((err: unknown) => {
        console.error(err)
        process.exitCode = 1
    })
}
