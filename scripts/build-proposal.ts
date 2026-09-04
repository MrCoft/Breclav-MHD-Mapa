import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateNetwork } from '../src/data/validate'
import { buildPatternsAndTrips, tripTiming } from './gtfs/convert'
import { loadScope } from './gtfs/read'
import { assertGeometrySane, assertStructurallySane, sortNetwork } from './build-network'
import { matchPatternGeometry, remeasureSimplified, straightLine } from './osm/match'
import { fetchRoutes } from './osm/overpass'
import { routePattern } from './osm/routePattern'
import { simplifyIndices } from './osm/simplify'
import { relationToLine } from './osm/stitch'
import { readWorkbook } from './proposal/xlsx'
import { parseSections, tripStopMinutes } from './proposal/sheet'
import { breclavStops, buildCandidates, isManesovaRow, matchStopName, resolveManesova } from './proposal/stopMatch'
import type { GeometryDiagnostics, GeometryFeature } from './build-network'
import type { StopVisit, TripShape } from './gtfs/convert'
import type { GeometrySource, PatternRouter, RelationLine } from './osm/match'
import type { OsmNode, OsmRelation, OsmWay } from './osm/overpass'
import type { Section } from './proposal/sheet'
import type { StopCandidate } from './proposal/stopMatch'
import type { DayMask, Line, Meta, Network, Pattern, Service, Stop, Trip } from '../src/types/network'

/** The shape committed to `geometry.geojson` — see `GeometryFeature` in build-network.ts. */
interface GeometryFile {
    type: 'FeatureCollection'
    features: GeometryFeature[]
}

export const CONVERTER_VERSION = '1.0.0'

const WORKBOOK_PATH = 'data/navrh_2026_new2.xlsx'
const OVERRIDES_PATH = 'data/proposed-stops.json'
const CURRENT_DIR = 'public/data/current'
const OUT_DIR = 'public/data/proposed'
// Proposed pattern ids reuse the current scenario's own numbering scheme ("561-0-1", …), which
// collides with the current scenario's *own* pattern ids for the same lines. Routing results are
// cached per pattern id (scripts/osm/routePattern.ts), so sharing that cache would silently hand
// a proposed pattern the current scenario's already-routed geometry for a same-numbered but
// different route. A separate cache directory avoids that; the OSM relation cache (keyed by bbox,
// not pattern) is safe to share and is reused as-is.
const ROUTING_CACHE_DIR = 'data/cache/routing-proposed'

const CITY_LINES = ['561', '562', '563', '565', '566', '567', '568', '569']
const INHERITED_LINES = ['571', '574']
const SERVICE_ID = 'vsedni-den'

const NA_ZAHRADACH_ID = 'breclav-na-zahradach'
const MANESOVA_NEW_ID = 'breclav-stara-breclav-manesova-2'
const J_SKACELA_ID = 'breclav-postorna-j-skacela-1-maje'

/**
 * The proposal's own long names, from PDF page 1 ("Uvažované vedení linek") — preferred over the
 * current scenario's long names since the routings genuinely differ. Transcribed by hand, with
 * the PDF's own spacing normalised and one typo fixed ("Vatlická" -> "Valtická", the same place
 * the workbook and every other PDF mention spell correctly).
 */
const LONG_NAMES: Record<string, string> = {
    '561': 'Městský hřbitov - Poštorná - Charvátská Nová Ves a zpět',
    '562': 'Městský hřbitov - Valtická Točna - Charvátská Nová Ves a zpět',
    '563': 'Autobusové nádraží - Slovácká - Cukrovar - Poliklinika - Poštorná, FOSFA a zpět',
    '565': 'Městský hřbitov - Sovadinova - Stará Břeclav a zpět',
    '566': 'Křižovatka Ladná - Sovadinova - Aut. Nádraží - Nám. TGM - Valtická Točna a zpět',
    '567': 'Autobusové nádraží - Hlavní - Valtická Točna a zpět',
    '568': 'Městský hřbitov - Poliklinika - Valtická Točna a zpět',
    '569': 'Charvátská Nová Ves - Hlavní - Autobusové nádraží - Stará Břeclav a zpět',
}

interface StopOverride {
    id: string
    name: string
    lat: number
    lon: number
    note: string
}

interface UnmatchedStop {
    line: string
    direction: 0 | 1
    row: number
    name: string
    status: 'unmatched' | 'ambiguous'
    candidates?: string[]
}

/** Resolves one section's stop rows to stop ids, deferring "Mánesova" rows to a second pass —
 *  see `resolveManesova`'s own doc comment for why. Pushes anything it cannot resolve onto
 *  `problems` rather than throwing immediately, so a single run surfaces every unmatched name at
 *  once. */
function resolveSectionStops(
    line: string,
    direction: 0 | 1,
    section: Section,
    candidates: StopCandidate[],
    problems: UnmatchedStop[],
): (string | undefined)[] {
    const resolved: (string | undefined)[] = section.stops.map((stop) => {
        if (isManesovaRow(stop.name)) {
            return undefined // resolved in the second pass below
        }
        const result = matchStopName(stop.name, candidates)
        if (result.status === 'matched') {
            return result.id
        }
        problems.push({
            line,
            direction,
            row: stop.row,
            name: stop.name,
            status: result.status,
            candidates: 'ids' in result ? result.ids : undefined,
        })
        return undefined
    })

    section.stops.forEach((stop, index) => {
        if (!isManesovaRow(stop.name)) {
            return
        }
        resolved[index] = resolveManesova(resolved[index - 1], resolved[index + 1], MANESOVA_NEW_ID)
    })

    return resolved
}

/** One section's trips as `TripShape`s, one per trip column, stops limited to what that
 *  particular trip actually serves — different subsets become different patterns downstream, in
 *  `buildPatternsAndTrips`, exactly as the GTFS converter already does for the current scenario.
 *  Timing follows decision 32's three rules, applied by the same `tripTiming` the GTFS converter
 *  uses. */
export function buildShapesForSection(
    line: string,
    direction: 0 | 1,
    grid: Map<string, string>,
    section: Section,
    resolvedIds: (string | undefined)[],
    stopById: Map<string, Stop>,
): TripShape[] {
    const shapes: TripShape[] = []
    for (const tripColumn of section.tripColumns) {
        const visits: StopVisit[] = []
        section.stops.forEach((stopRow, index) => {
            const minutes = tripStopMinutes(grid, stopRow.row, tripColumn.column)
            if (minutes === undefined) {
                return
            }
            const id = resolvedIds[index]
            if (!id) {
                throw new Error(`line ${line} dir ${direction}: stop row ${stopRow.row} has no resolved id`)
            }
            // The workbook writes a timing point the vehicle stands at as two rows for the same
            // stop, an arrival (`příj.`) and a departure (`odj.`) — one visit, not two (known bug
            // 7). Recognised by this trip's own served sequence repeating a stop, rather than by
            // column C's marker, which also labels every section's first and last row and is blank
            // on both rows of 569's Stará Břeclav pair; and rather than by adjacent rows, because
            // 569's two bus-station calls sit four never-served rows apart on the trips that run
            // straight through. A genuine revisit keeps its calls apart by serving stops between
            // them; one that served none would be standing at the stop either way.
            const previous = visits.at(-1)
            if (previous?.stop === id) {
                previous.departure = minutes
                return
            }
            visits.push({ stop: id, arrival: minutes, departure: minutes })
        })
        if (visits.length < 2) {
            continue // a trip with fewer than 2 served stops carries no useful route
        }
        const tripId = `${line}-${direction}-${tripColumn.number}`
        const headStop = stopById.get(visits[visits.length - 1]!.stop)
        if (!headStop) {
            throw new Error(`line ${line}: stop id ${visits[visits.length - 1]!.stop} has no known name for a headsign`)
        }
        const { arrivals, dwells } = tripTiming(tripId, visits)
        shapes.push({
            tripId,
            routeId: line,
            directionId: direction,
            headsign: headStop.name,
            serviceId: SERVICE_ID,
            stops: visits.map((visit) => visit.stop),
            arrivals,
            dwells,
        })
    }
    return shapes
}

function buildCityLines(current: Network): Line[] {
    return CITY_LINES.map((id): Line => {
        const existing = current.lines.find((l) => l.id === id)
        if (!existing) {
            throw new Error(`buildCityLines: line ${id} not found in the current scenario to copy colour/mode from`)
        }
        const longName = LONG_NAMES[id]
        if (!longName) {
            throw new Error(`buildCityLines: no PDF long name recorded for line ${id}`)
        }
        return { id, name: id, longName, mode: existing.mode, color: existing.color, textColor: existing.textColor }
    })
}

interface Inherited {
    lines: Line[]
    patterns: Pattern[]
    trips: Trip[]
    services: Service[]
    stopIds: Set<string>
    geometry: GeometryFeature[]
}

const WEEKDAY_MASK: DayMask = [1, 1, 1, 1, 1, 0, 0]

function isWeekdayMask(days: DayMask): boolean {
    return WEEKDAY_MASK.every((flag, i) => flag === days[i])
}

/**
 * The current scenario's own core Monday–Friday service — the weekday-masked service with the
 * widest `from`..`to` span, rather than a specific id assumed stable across a feed rebuild
 * (`build-network.ts` numbers GTFS `service_id`s straight from the feed, which owes this project
 * nothing). The workbook gives only a day mask ("Všední den neprázdninový"), not a date range or
 * a holiday calendar, so this is the closest honest source for both: whatever the current feed
 * itself already treats as its core school-term weekday (findings I8 and I10).
 */
export function coreWeekdayService(services: Service[]): Service {
    const candidates = services.filter((s) => isWeekdayMask(s.days))
    if (candidates.length === 0) {
        throw new Error(
            'coreWeekdayService: the current scenario has no Monday-Friday service to derive the proposal’s ' +
                'own service window (and holiday calendar) from.',
        )
    }
    const spanDays = (s: Service) => Date.parse(s.to) - Date.parse(s.from)
    return candidates.reduce((widest, s) => (spanDays(s) > spanDays(widest) ? s : widest))
}

/** Lines 571 and 574 carried over from the current scenario exactly as they are — see the task
 *  brief: the proposal changes both (cancels 564 in favour of 574, has 571 call at every
 *  intermediate stop) but supplies no timetable for either, so synthesising one would be
 *  inventing data no source actually gives. */
function buildInherited(current: Network, currentGeometry: GeometryFile): Inherited {
    const lines = current.lines.filter((l) => INHERITED_LINES.includes(l.id))
    const patterns = current.patterns.filter((p) => INHERITED_LINES.includes(p.line))
    const patternIds = new Set(patterns.map((p) => p.id))
    const trips = current.trips.filter((t) => patternIds.has(t.pattern))
    const serviceIds = new Set(trips.map((t) => t.service))
    const services = current.services.filter((s) => serviceIds.has(s.id))
    const stopIds = new Set(patterns.flatMap((p) => p.stops))

    const geometry = currentGeometry.features.filter((f) => patternIds.has(f.properties.patternId))
    const missing = [...patternIds].filter((id) => !geometry.some((f) => f.properties.patternId === id))
    if (missing.length > 0) {
        throw new Error(
            `buildInherited: current scenario has no geometry for inherited pattern(s): ${missing.join(', ')}`,
        )
    }

    return { lines, patterns, trips, services, stopIds, geometry }
}

async function main(): Promise<void> {
    const scope = loadScope()

    const current = JSON.parse(readFileSync(join(CURRENT_DIR, 'network.json'), 'utf8')) as Network
    const currentMeta = JSON.parse(readFileSync(join(CURRENT_DIR, 'meta.json'), 'utf8')) as Meta
    const currentGeometry = JSON.parse(readFileSync(join(CURRENT_DIR, 'geometry.geojson'), 'utf8')) as GeometryFile
    const overrides = JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8')) as StopOverride[]
    const overrideIds = new Set(overrides.map((o) => o.id))
    for (const expected of [NA_ZAHRADACH_ID, MANESOVA_NEW_ID, J_SKACELA_ID]) {
        if (!overrideIds.has(expected)) {
            throw new Error(`${OVERRIDES_PATH} is missing the expected override stop ${expected}`)
        }
    }

    // The Mánesova override is deliberately excluded from the generic candidate pool: its name
    // is identical to the existing stop's, so it can only ever be reached through
    // `resolveManesova`'s explicit neighbour rule, never through ordinary fuzzy matching.
    const matchableOverrides = overrides.filter((o) => o.id !== MANESOVA_NEW_ID)
    const candidates = buildCandidates([...breclavStops(current.stops), ...matchableOverrides])

    const overrideStopsById = new Map<string, Stop>(
        overrides.map((o) => [o.id, { id: o.id, name: o.name, lat: o.lat, lon: o.lon }]),
    )
    const stopById = new Map<string, Stop>([
        ...current.stops.map((s): [string, Stop] => [s.id, s]),
        ...overrideStopsById,
    ])

    console.log('Reading proposal workbook…')
    const sheets = await readWorkbook(WORKBOOK_PATH, (name) => CITY_LINES.includes(name))
    const sheetNames = new Set(sheets.map((s) => s.name))
    const missingSheets = CITY_LINES.filter((line) => !sheetNames.has(line))
    if (missingSheets.length > 0) {
        throw new Error(`workbook is missing the expected sheet(s): ${missingSheets.join(', ')}`)
    }

    const problems: UnmatchedStop[] = []
    const allShapes: TripShape[] = []
    const usedStopIds = new Set<string>()

    for (const sheet of sheets) {
        const sections = parseSections(sheet.grid)
        if (sections.length !== 2) {
            throw new Error(
                `line ${sheet.name}: expected exactly 2 direction sections (one outbound, one "opačný směr"), found ${sections.length}`,
            )
        }
        sections.forEach((section, index) => {
            const direction = index as 0 | 1
            const resolvedIds = resolveSectionStops(sheet.name, direction, section, candidates, problems)
            if (problems.length > 0) {
                return // keep scanning the rest of this line's rows so every problem is collected
            }
            for (const id of resolvedIds) {
                if (id) {
                    usedStopIds.add(id)
                }
            }
            const shapes = buildShapesForSection(sheet.name, direction, sheet.grid, section, resolvedIds, stopById)
            allShapes.push(...shapes)
        })
    }

    if (problems.length > 0) {
        const lines = problems.map(
            (p) =>
                `  line ${p.line} dir ${p.direction} row ${p.row}: "${p.name}" — ${p.status}` +
                (p.candidates ? ` (${p.candidates.join(', ')})` : ''),
        )
        throw new Error(`Could not match every proposal stop name to an existing stop:\n${lines.join('\n')}`)
    }

    const lineIds = new Map(CITY_LINES.map((id) => [id, id]))
    const { patterns: cityPatterns, trips: cityTrips } = buildPatternsAndTrips(allShapes, lineIds)

    const currentCoreWeekday = coreWeekdayService(current.services)
    const service: Service = {
        id: SERVICE_ID,
        days: WEEKDAY_MASK,
        // Same validity window, and the same `removed` dates (Czech public holidays that the
        // core service excludes even though they fall on a weekday), as the current scenario's
        // own core weekday service — see `coreWeekdayService`'s doc comment for why this is the
        // closest honest source for both (findings I8 and I10).
        from: currentCoreWeekday.from,
        to: currentCoreWeekday.to,
        removed: currentCoreWeekday.removed,
    }

    const inherited = buildInherited(current, currentGeometry)

    const network = sortNetwork({
        stops: [...usedStopIds, ...inherited.stopIds]
            .map((id) => stopById.get(id))
            .filter((s): s is Stop => s !== undefined),
        lines: [...buildCityLines(current), ...inherited.lines],
        patterns: [...cityPatterns, ...inherited.patterns],
        services: [service, ...inherited.services],
        trips: [...cityTrips, ...inherited.trips],
    })

    validateNetwork(network)
    // Not `assertSane`: its route-count band is sized for the full GTFS-derived network
    // (`config/scope.json`) and would reject this proposal's 10 lines outright. The structural
    // checks — no trips, a pattern with fewer than 2 stops, a stop no pattern serves — apply
    // just as much to this hand-and-spreadsheet-derived network, though, so they still run.
    assertStructurallySane(network)

    console.log('Fetching OSM relations…')
    const osm = await fetchRoutes(scope, { refresh: false })
    const relations = osm.elements.filter((e): e is OsmRelation => e.type === 'relation')
    const ways = osm.elements.filter((e): e is OsmWay => e.type === 'way')
    const nodes = osm.elements.filter((e): e is OsmNode => e.type === 'node')
    const relationLines: RelationLine[] = relations
        .map((r) => ({ ref: r.tags.ref ?? '', coordinates: relationToLine(r, ways, nodes) }))
        .filter((r) => r.ref !== '' && r.coordinates.length >= 2)

    // Every proposed city pattern is a bus route — no rail graph is needed.
    const router: PatternRouter = async (pattern, stopCoords) =>
        routePattern(pattern, stopCoords, { mode: 'bus', cacheDir: ROUTING_CACHE_DIR })

    const counts = { osm: 0, routed: 0, straight: 0, override: 0 }
    const features: GeometryFeature[] = []
    const diagnostics: GeometryDiagnostics[] = []

    console.log(`Routing ${cityPatterns.length} proposed patterns (politely — one OSRM request per second)…`)
    for (const pattern of cityPatterns) {
        const line = network.lines.find((l) => l.id === pattern.line)!
        const {
            coordinates,
            stopDistances: originalStopDistances,
            source,
        } = await matchPatternGeometry({
            pattern,
            stops: stopById,
            relations: relationLines,
            router,
        })
        counts[source] += 1

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
        diagnostics.push({ patternId: pattern.id, maxOffMetres, maxClampMetres })
        const origin = along[0] ?? 0
        const stopDistances = along.map((a) => Math.max(0, a - origin))

        features.push({
            type: 'Feature',
            properties: {
                patternId: pattern.id,
                lineId: line.id,
                lineName: line.name,
                mode: line.mode,
                color: line.color,
                source,
                stopDistances,
            },
            geometry: { type: 'LineString', coordinates: simplified },
        })
    }

    // Inherited patterns keep their current-scenario geometry unchanged — recomputing it would
    // contradict "carried over exactly as they are", and could legitimately produce a different
    // result (a different OSM relation state, a different OSRM answer) than what shipped before.
    const knownSources: GeometrySource[] = ['override', 'osm', 'routed', 'straight']
    for (const feature of inherited.geometry) {
        const source = feature.properties.source
        if (!knownSources.includes(source as GeometrySource)) {
            throw new Error(`inherited geometry for ${feature.properties.patternId} has an unknown source "${source}"`)
        }
        counts[source as GeometrySource] += 1
    }
    const allFeatures = [...features, ...inherited.geometry]

    assertGeometrySane(allFeatures, diagnostics, network.patterns)

    const patternIdsWithGeometry = new Set(allFeatures.map((f) => f.properties.patternId))
    const patternsWithoutGeometry = network.patterns.filter((p) => !patternIdsWithGeometry.has(p.id))
    if (patternsWithoutGeometry.length > 0) {
        throw new Error(`pattern(s) with no geometry: ${patternsWithoutGeometry.map((p) => p.id).join(', ')}`)
    }

    const meta: Meta = {
        // The proposal has no feed of its own — its stops and its two inherited lines come from
        // the current scenario's already-baked network, so that scenario's own feed date is the
        // honest answer here too, rather than a value that silently stops tracking it (I8).
        feedDate: currentMeta.feedDate,
        generatedAt: new Date().toISOString(),
        converterVersion: CONVERTER_VERSION,
        geometrySources: counts,
        // Records which `current` build this proposal was derived from, so a stale derivation —
        // this scenario built against a `current` that has since been regenerated with a
        // different feed — can be spotted by diffing against `current`'s own meta.json, instead
        // of assuming the two always match (I8).
        derivedFrom: { scenarioId: 'current', feedDate: currentMeta.feedDate, generatedAt: currentMeta.generatedAt },
        inheritedLines: {
            lines: INHERITED_LINES,
            note:
                'The proposal cancels 564 in favour of 574 and has 571 call at every intermediate stop, but ' +
                'supplies no timetable for either change. Both lines are carried over from the current scenario ' +
                'unchanged (same patterns, trips and geometry) rather than synthesised.',
        },
    }

    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(join(OUT_DIR, 'network.json'), `${JSON.stringify(network, null, 1)}\n`, 'utf8')
    writeFileSync(
        join(OUT_DIR, 'geometry.geojson'),
        `${JSON.stringify({ type: 'FeatureCollection', features: allFeatures })}\n`,
        'utf8',
    )
    writeFileSync(join(OUT_DIR, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')

    console.log(
        `${network.lines.length} lines, ${network.stops.length} stops, ${network.patterns.length} patterns, ${network.trips.length} trips`,
    )
    console.log(
        `Geometry: ${counts.osm} from OSM relations, ${counts.routed} routed, ${counts.override} overridden, ${counts.straight} straight-line fallbacks`,
    )
}

if (process.argv[1]?.endsWith('build-proposal.ts')) {
    main().catch((err: unknown) => {
        console.error(err)
        process.exitCode = 1
    })
}
