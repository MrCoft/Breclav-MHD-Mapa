import { MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '@tanstack/react-store'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { buildPatternGeometry } from '../domain/patternGeometry'
import { vehiclesAt } from '../domain/vehicles'
import { clock } from '../state/clock'
import { appStore, selectStop } from '../state/store'
import { BasemapSwitcher } from './BasemapSwitcher'
import { BASEMAPS, DEFAULT_BASEMAP_ID } from './basemaps'
import { BASEMAP_STYLE, BRECLAV_CENTER, DIM_COLOR, INITIAL_ZOOM, NO_LINE, SELECTED_STOP_COLOR } from './style'
import type { DataDrivenPropertyValueSpecification, GeoJSONSource, MapSourceDataEvent } from 'maplibre-gl'
import type { FeatureCollection, Point } from 'geojson'
import type { ClockState } from '../state/clock'
import type { PatternGeometry } from '../domain/patternGeometry'
import type { Scenario } from '../data/loadScenario'

// maplibre-gl computes its worker script's URL at runtime relative to its own bundled
// location, which bundlers can't statically rewrite. Routing the worker file through Vite's
// `?worker&url` pipeline emits a self-contained chunk (with its internal shared-code import
// resolved), and pointing maplibre-gl at that URL up front avoids the broken default lookup —
// otherwise the worker 404s (dev) or silently fails to start (production build) and the map
// never draws anything past the basemap background.
setWorkerUrl(workerUrl)

const ROUTE_WIDTH: DataDrivenPropertyValueSpecification<number> = [
    'interpolate',
    ['linear'],
    ['zoom'],
    10,
    2,
    14,
    4,
    17,
    7,
]
/** routes-casing draws about 3px wider than routes-active at every zoom stop, underneath it. */
const CASING_WIDTH: DataDrivenPropertyValueSpecification<number> = [
    'interpolate',
    ['linear'],
    ['zoom'],
    10,
    5,
    14,
    7,
    17,
    10,
]

// Vehicles are the moving focus of the map and must read as unmistakably vehicles, not dots, at
// the default zoom — the label text drives the badge's on-screen size (via icon-text-fit below),
// so this interpolation is what makes the whole badge, not just a fixed circle, unmistakable at
// zoom 12 and not overwhelming at zoom 15.
const VEHICLE_TEXT_SIZE: DataDrivenPropertyValueSpecification<number> = [
    'interpolate',
    ['linear'],
    ['zoom'],
    11,
    8,
    15,
    12,
]

/**
 * A rounded-rectangle badge, drawn once per line onto a canvas and registered with
 * `map.addImage(..., { stretchX, stretchY, content })`, so a symbol layer's `icon-text-fit: 'both'`
 * can stretch it to fit whatever label it holds — wide for "572", narrow for "S8" — rather than the
 * fixed-radius circle this replaces, which could not grow to fit a three-character line number.
 *
 * All dimensions below are raw image pixels at `BADGE_PIXEL_RATIO`, i.e. `BADGE_PIXEL_RATIO` raw
 * px = 1 CSS px on screen once MapLibre divides by that ratio. `BADGE_CORNER_RADIUS` and
 * `BADGE_BORDER_WIDTH` together form `BADGE_FIXED_MARGIN`, the border strip on every edge that
 * `stretchX`/`stretchY` exclude — MapLibre holds that margin at a constant *screen* pixel size
 * (about 3.5px radius, 1.5px border, echoing the old circle's 2px white stroke and the sidebar's
 * `LineBadge` corner rounding) no matter how large the stretched interior grows. `BADGE_TEMPLATE_SIZE`
 * is only the source image's own at-rest size — MapLibre stretches from it in either direction, so
 * its exact value doesn't matter beyond leaving a non-zero sliver for `stretchX`/`stretchY` to
 * point at. What does matter: `BADGE_FIXED_MARGIN` (5px per side on screen) must stay comfortably
 * smaller than the smallest badge this ever renders — a two-character label at the minimum zoom —
 * or the fixed corners on opposite edges would collide.
 */
const BADGE_PIXEL_RATIO = 2
const BADGE_CORNER_RADIUS = 7
const BADGE_BORDER_WIDTH = 3
const BADGE_FIXED_MARGIN = BADGE_CORNER_RADIUS + BADGE_BORDER_WIDTH
const BADGE_STRETCH_SLIVER = 8
const BADGE_TEMPLATE_SIZE = BADGE_FIXED_MARGIN * 2 + BADGE_STRETCH_SLIVER
const BADGE_BORDER_COLOR = '#ffffff'

/** Extra breathing room (CSS px: top, right, bottom, left) added around the fitted text, on top
 * of the stretched badge's own content box — more on the sides than top/bottom for a pill-ish
 * proportion, matching the sidebar's `LineBadge` (`px-1.5 py-0.5`). Constant across zoom: the
 * badge's overall size already scales with `VEHICLE_TEXT_SIZE`, so fixed padding just keeps the
 * same visual proportion at every zoom rather than adding a second interpolation to track. */
const VEHICLE_BADGE_PADDING: [number, number, number, number] = [1, 3.5, 1, 3.5]

/**
 * The `Noto Sans Bold` font family used here is a deliberate substitute for this project's own
 * `@fontsource-variable/geist-mono` — that face is a *web* font, loaded via `@font-face` for
 * ordinary DOM text (see `ClockControls`'s digital clock), and MapLibre symbol layers cannot use
 * it. `text-font` instead names a font stack that must be pre-rendered as SDF glyph tiles and
 * served from the active style's `glyphs` URL; every basemap here points at
 * `tiles.openfreemap.org/fonts`, which does not host "Geist Mono" under any spelling (confirmed:
 * `/fonts/Geist%20Mono%20Regular/0-255.pbf` 404s) — self-hosting a generated glyph set is real
 * build-pipeline work outside this task's scope. `Noto Sans Bold` is hosted there and used by the
 * basemaps' own labels, so it renders reliably everywhere routes-active pattern selection does.
 */
const VEHICLE_TEXT_FONT = ['Noto Sans Bold']

interface VehicleFeatureProperties {
    tripKey: string
    lineId: string
    lineName: string
    color: string
    textColor: string
}

/** A pattern's line id paired with the same mapped route colour drawn on the map, and the line's
 * (unmapped) text colour — everything a vehicle feature needs to be styled like its line. */
interface LineDisplayColors {
    color: string
    textColor: string
}

/** Every pattern's precomputed polyline, keyed by pattern id, plus each line's display colours —
 * built once per scenario load (see the `useMemo` in `MapView`), never recomputed per frame. */
interface VehicleGeometryContext {
    geometries: ReadonlyMap<string, PatternGeometry>
    colorsByLine: ReadonlyMap<string, LineDisplayColors>
}

function emptyVehicleFeatureCollection(): FeatureCollection<Point, VehicleFeatureProperties> {
    return { type: 'FeatureCollection', features: [] }
}

/**
 * Every running vehicle at `date`/`minutes`, as a GeoJSON `FeatureCollection` ready for
 * `setData`. `minutes` stays fractional (never rounded) — that fractional value is exactly what
 * makes motion between stops continuous rather than a jump once per whole minute.
 */
function vehicleFeatureCollection(
    scenario: Scenario,
    context: VehicleGeometryContext,
    date: string,
    minutes: number,
): FeatureCollection<Point, VehicleFeatureProperties> {
    const vehicles = vehiclesAt(scenario.index, context.geometries, date, minutes)
    return {
        type: 'FeatureCollection',
        features: vehicles.map((vehicle) => {
            const colors = context.colorsByLine.get(vehicle.lineId)
            return {
                type: 'Feature',
                properties: {
                    tripKey: vehicle.tripKey,
                    lineId: vehicle.lineId,
                    lineName: vehicle.lineName,
                    color: colors?.color ?? DIM_COLOR,
                    textColor: colors?.textColor ?? '#ffffff',
                },
                geometry: { type: 'Point', coordinates: [vehicle.lon, vehicle.lat] },
            }
        }),
    }
}

function stopsGeoJson(scenario: Scenario): FeatureCollection<Point> {
    return {
        type: 'FeatureCollection',
        features: scenario.index.network.stops.map((stop) => ({
            type: 'Feature',
            properties: { id: stop.id, name: stop.name },
            geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
        })),
    }
}

/** Stops served by `selectedLine`'s patterns, or an empty collection when no line is selected. */
function selectedStopsGeoJson(scenario: Scenario, selectedLine: string | null): FeatureCollection<Point> {
    if (selectedLine === null) {
        return { type: 'FeatureCollection', features: [] }
    }

    const stopIds = new Set<string>()
    for (const pattern of scenario.index.patterns.values()) {
        if (pattern.line === selectedLine) {
            for (const stopId of pattern.stops) {
                stopIds.add(stopId)
            }
        }
    }

    const features = [...stopIds]
        .map((stopId) => scenario.index.stops.get(stopId))
        .filter((stop) => stop !== undefined)
        .map((stop) => ({
            type: 'Feature' as const,
            properties: { id: stop.id, name: stop.name },
            geometry: { type: 'Point' as const, coordinates: [stop.lon, stop.lat] },
        }))

    return { type: 'FeatureCollection', features }
}

function badgeImageId(lineId: string): string {
    return `badge-${lineId}`
}

/** The pixel data plus the `addImage` stretch metadata for one line's badge — computed together
 * since both derive from the same `BADGE_*` template geometry. */
interface BadgeImage {
    pixels: ImageData
    options: {
        pixelRatio: number
        stretchX: [number, number][]
        stretchY: [number, number][]
        content: [number, number, number, number]
    }
}

/**
 * Draws one line's badge — a rounded rectangle filled in `color` with a light border, the same
 * pairing the old circle used (`circle-color` plus a white `circle-stroke`) so the badge still
 * separates from the coloured route line it sits on — onto a small canvas, sized and stretch-
 * mapped per the `BADGE_*` constants above. Called once per line per style load, never per frame.
 */
function renderBadgeImage(color: string): BadgeImage {
    const canvas = document.createElement('canvas')
    canvas.width = BADGE_TEMPLATE_SIZE
    canvas.height = BADGE_TEMPLATE_SIZE
    const context = canvas.getContext('2d')
    if (!context) {
        throw new Error('2D canvas context unavailable — cannot render a vehicle badge image.')
    }

    const inset = BADGE_BORDER_WIDTH / 2
    context.beginPath()
    context.roundRect(
        inset,
        inset,
        BADGE_TEMPLATE_SIZE - BADGE_BORDER_WIDTH,
        BADGE_TEMPLATE_SIZE - BADGE_BORDER_WIDTH,
        BADGE_CORNER_RADIUS,
    )
    context.fillStyle = color
    context.fill()
    context.strokeStyle = BADGE_BORDER_COLOR
    context.lineWidth = BADGE_BORDER_WIDTH
    context.stroke()

    const stretchStart = BADGE_FIXED_MARGIN
    const stretchEnd = BADGE_TEMPLATE_SIZE - BADGE_FIXED_MARGIN
    return {
        pixels: context.getImageData(0, 0, BADGE_TEMPLATE_SIZE, BADGE_TEMPLATE_SIZE),
        options: {
            pixelRatio: BADGE_PIXEL_RATIO,
            stretchX: [[stretchStart, stretchEnd]],
            stretchY: [[stretchStart, stretchEnd]],
            content: [stretchStart, stretchStart, stretchEnd, stretchEnd],
        },
    }
}

/**
 * Registers (or refreshes) one line's badge image under a stable `badge-<lineId>` id — the name
 * `vehicles-badge`'s `icon-image` expression looks up with `['concat', 'badge-', ['get', 'lineId']]`.
 * `updateImage` is used instead of `removeImage`+`addImage` when the id is already known: it
 * replaces only the pixels, keeping the `addImage` stretch/content metadata (which never changes
 * for a given line) intact, and — unlike calling `addImage` on an id that already exists — never
 * fires an `ErrorEvent`. The two paths converge to the same visible result either way; `updateImage`
 * is just the cheaper, quieter one when the image is already there.
 */
function ensureBadgeImage(instance: MapLibreMap, lineId: string, color: string): void {
    const id = badgeImageId(lineId)
    const { pixels, options } = renderBadgeImage(color)
    if (instance.hasImage(id)) {
        instance.updateImage(id, pixels)
    } else {
        instance.addImage(id, pixels, options)
    }
}

/**
 * Registers every line's badge image. `map.setStyle()` discards the image registry along with
 * every custom source and layer, so this needs the same "re-run it" treatment `installLayers`
 * documents for sources and layers — it's called from inside `installLayers` on every fresh
 * install (after a basemap switch discards the previous style's images) and, separately, whenever
 * a scenario switch lands without a style reset (`updateScenarioSources`'s caller, since that path
 * never runs `installLayers` at all — the `routes` source already exists so its guard no-ops).
 * There are only about twenty lines, and this only ever runs at either of those two moments, never
 * per animation frame.
 */
function installBadgeImages(instance: MapLibreMap, colorsByLine: ReadonlyMap<string, LineDisplayColors>): void {
    for (const [lineId, colors] of colorsByLine) {
        ensureBadgeImage(instance, lineId, colors.color)
    }
}

/**
 * Adds every route/stop source and layer. Idempotent — a no-op once `routes` exists — so it's
 * safe to call again after a basemap switch. `map.setStyle()` discards every custom source and
 * layer, silently leaving a bare basemap; the caller re-runs this on the style's `styledata`
 * event to put the network back. Returns whether it actually installed anything, so the caller
 * can skip re-running selection/interaction setup on the (frequent) no-op calls — `styledata`
 * fires repeatedly while a style loads, and redundantly re-applying an unchanged `null` filter
 * on every one of those firings was observed to stop the routes source from ever finishing its
 * own load, leaving the map blank.
 *
 * Layer order, bottom to top: routes-dim, routes-casing, routes-active, stops-circle,
 * stops-selected-circle, stops-label, vehicles-badge.
 */
function installLayers(
    instance: MapLibreMap,
    scenario: Scenario,
    initialVehicles: FeatureCollection<Point, VehicleFeatureProperties>,
    colorsByLine: ReadonlyMap<string, LineDisplayColors>,
): boolean {
    if (instance.getSource('routes')) {
        return false
    }

    instance.addSource('routes', { type: 'geojson', data: scenario.geometry })
    instance.addSource('stops', { type: 'geojson', data: stopsGeoJson(scenario) })
    instance.addSource('stops-selected', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

    instance.addLayer({
        id: 'routes-dim',
        type: 'line',
        source: 'routes',
        filter: ['==', ['get', 'lineId'], NO_LINE],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': DIM_COLOR, 'line-width': 2 },
    })
    instance.addLayer({
        id: 'routes-casing',
        type: 'line',
        source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
            'line-color': ['get', 'casingColor'],
            'line-width': CASING_WIDTH,
        },
    })
    instance.addLayer({
        id: 'routes-active',
        type: 'line',
        source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
            'line-color': ['get', 'color'],
            'line-width': ROUTE_WIDTH,
            'line-opacity': 0.85,
        },
    })
    instance.addLayer({
        id: 'stops-circle',
        type: 'circle',
        source: 'stops',
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 15, 5],
            'circle-color': '#ffffff',
            'circle-stroke-color': '#37404a',
            'circle-stroke-width': 1.5,
        },
    })
    instance.addLayer({
        id: 'stops-selected-circle',
        type: 'circle',
        source: 'stops-selected',
        paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 15, 8],
            'circle-color': SELECTED_STOP_COLOR,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1.5,
        },
    })
    instance.addLayer({
        id: 'stops-label',
        type: 'symbol',
        source: 'stops',
        minzoom: 13,
        layout: {
            'text-field': ['get', 'name'],
            'text-size': 11,
            'text-offset': [0, 1.1],
            'text-anchor': 'top',
        },
        paint: { 'text-color': '#26303a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    })

    // Seeded with `initialVehicles` — the clock's *current* state, computed by the caller via
    // `clock.getState()` — rather than starting empty and waiting for the clock subscription's
    // own `setData` to fill it in. That subscription's inaugural call (`clock.subscribe` calls
    // its listener once, synchronously, at registration) can land before this function has even
    // run, in which case it silently drops (see the `getSource('vehicles')` guard in `MapView`'s
    // clock-subscription effect) — while playing, the very next animation frame repeats it a
    // moment later and nothing is ever visibly wrong, but a paused clock never schedules another
    // frame, so that drop used to be permanent (known-bugs.md entry 4: a paused `?d=`/`?t=` deep
    // link showed routes with zero vehicles, indefinitely). Seeding here instead means the source
    // is never empty for longer than it takes this function to run, regardless of whether the
    // map's style finished loading before or after the clock subscription registered.
    instance.addSource('vehicles', { type: 'geojson', data: initialVehicles })

    // One badge image per line, in that line's own mapped colour — not a single SDF image tinted
    // per feature via `icon-color`. There are only about twenty lines, so pre-rendering each is
    // cheap, gives exact colours with no tinting-precision concerns, and sidesteps having to
    // verify SDF recolouring composes correctly with stretchable `icon-text-fit` content regions
    // in this MapLibre version — a real fiddly-detail risk the per-line-image route avoids outright.
    // Must run before the layer below is added, so the very first paint already has every image
    // `icon-image`'s expression can look up rather than falling back to nothing for one frame.
    installBadgeImages(instance, colorsByLine)

    instance.addLayer({
        id: 'vehicles-badge',
        type: 'symbol',
        source: 'vehicles',
        layout: {
            // Matches `badgeImageId` exactly — this is how each vehicle picks its own line's
            // pre-rendered, pre-coloured badge out of the images `installBadgeImages` registered.
            'icon-image': ['concat', 'badge-', ['get', 'lineId']],
            // Stretches the badge (see the BADGE_* constants above) to wrap whatever `text-field`
            // needs on both axes — this is what lets "572" and "S8" each get a badge sized to fit,
            // rather than a fixed circle either overflows or wastes.
            'icon-text-fit': 'both',
            'icon-text-fit-padding': VEHICLE_BADGE_PADDING,
            // Same reasoning as text-allow-overlap/text-ignore-placement below, applied to the icon
            // half of this layer: vehicles are few and keep moving, so every badge should always
            // show rather than flicker in and out as MapLibre's default collision avoidance jostles
            // them for space.
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'text-field': ['get', 'lineName'],
            'text-font': VEHICLE_TEXT_FONT,
            'text-size': VEHICLE_TEXT_SIZE,
            'text-allow-overlap': true,
            'text-ignore-placement': true,
        },
        paint: {
            // The badge's border lives baked into its image, not a separate stroke paint property
            // — dimming `icon-opacity` alone (see `vehicleOpacity`/`applySelection`) dims the whole
            // badge, border included, the same way the old circle-plus-stroke pair dimmed together.
            'icon-opacity': 1,
            'text-color': ['get', 'textColor'],
            'text-opacity': 1,
        },
    })

    return true
}

/**
 * Pushes a freshly loaded scenario's routes and stops into the sources `installLayers` already
 * created, in place — for a scenario switch that doesn't coincide with a basemap change, so the
 * sources survive rather than being torn down and rebuilt by `setStyle`. Without this,
 * `installLayers`'s no-op guard would leave the map drawing the previous scenario's network
 * indefinitely. `stops-selected` doesn't need pushing here — it updates through `applySelection`,
 * called by this component's own selection effect right after this one runs — and neither does
 * `vehicles`, which the clock subscription further down rewrites every animation frame from the
 * current `scenario` and its freshly rebuilt `PatternGeometry` set.
 */
function updateScenarioSources(instance: MapLibreMap, scenario: Scenario): void {
    const routes = instance.getSource('routes')
    if (routes) {
        ;(routes as GeoJSONSource).setData(scenario.geometry)
    }
    const stops = instance.getSource('stops')
    if (stops) {
        ;(stops as GeoJSONSource).setData(stopsGeoJson(scenario))
    }
}

/** Full opacity when nothing is selected or a vehicle's line matches the selection, dimmed otherwise. */
function vehicleOpacity(selectedLine: string | null): DataDrivenPropertyValueSpecification<number> {
    if (selectedLine === null) {
        return 1
    }
    return ['case', ['==', ['get', 'lineId'], selectedLine], 1, 0.25]
}

/**
 * Re-applies the current line selection to the route filters, the selected-stops source, and
 * vehicle prominence. Needed both on ordinary selection changes and after `installLayers`
 * re-runs post basemap switch, when the freshly re-added layers are back to their unfiltered
 * defaults.
 */
function applySelection(instance: MapLibreMap, scenario: Scenario, selectedLine: string | null): void {
    if (!instance.getLayer('routes-active')) {
        return
    }

    if (selectedLine === null) {
        instance.setFilter('routes-active', null)
        instance.setFilter('routes-casing', null)
        instance.setFilter('routes-dim', ['==', ['get', 'lineId'], NO_LINE])
    } else {
        instance.setFilter('routes-active', ['==', ['get', 'lineId'], selectedLine])
        instance.setFilter('routes-casing', ['==', ['get', 'lineId'], selectedLine])
        instance.setFilter('routes-dim', ['!=', ['get', 'lineId'], selectedLine])
    }

    const source = instance.getSource('stops-selected')
    if (source) {
        ;(source as GeoJSONSource).setData(selectedStopsGeoJson(scenario, selectedLine))
    }

    // Vehicles of other lines dim rather than disappear — a `setPaintProperty` on the existing
    // layer, same as the filters above, never a `setData` rebuild of the `vehicles` source.
    if (instance.getLayer('vehicles-badge')) {
        const opacity = vehicleOpacity(selectedLine)
        instance.setPaintProperty('vehicles-badge', 'icon-opacity', opacity)
        instance.setPaintProperty('vehicles-badge', 'text-opacity', opacity)
    }
}

/**
 * `routes` is a GeoJSON source, so MapLibre parses its data inside the worker script set up by
 * `setWorkerUrl` above — if the worker never loads (the historical failure this signal exists to
 * catch), that source never produces features while every React-rendered element (sidebar,
 * footer, stop panel) renders normally regardless. `querySourceFeatures` only returns features
 * from tiles that have actually finished loading for the current viewport, so it is genuinely
 * zero when the worker is dead and non-zero once the worker has done real work — unlike
 * `getSource`, which only proves the source was *configured*, not that it produced anything.
 * Writing the count to a `data-` attribute on the map container turns that into a signal a
 * Playwright assertion can wait on without touching the canvas.
 */
function updateRoutesRendered(instance: MapLibreMap, node: HTMLDivElement): void {
    node.dataset.routesRendered = String(instance.querySourceFeatures('routes').length)
}

/**
 * Same signal as `updateRoutesRendered`, for the `vehicles` source — this is what a Playwright
 * assertion reads to tell "routes drew but the vehicle race silently dropped every position" (see
 * known-bugs.md entry 4) apart from "nothing rendered at all", without reaching into the WebGL
 * canvas or the map instance itself.
 */
function updateVehiclesRendered(instance: MapLibreMap, node: HTMLDivElement): void {
    node.dataset.vehiclesRendered = String(instance.querySourceFeatures('vehicles').length)
}

function attachInteractions(instance: MapLibreMap): void {
    instance.on('click', 'stops-circle', (event) => {
        const id = event.features?.[0]?.properties.id
        if (typeof id === 'string') {
            selectStop(id)
        }
    })
    instance.on('mouseenter', 'stops-circle', () => {
        instance.getCanvas().style.cursor = 'pointer'
    })
    instance.on('mouseleave', 'stops-circle', () => {
        instance.getCanvas().style.cursor = ''
    })
}

export const MapView = () => {
    const container = useRef<HTMLDivElement>(null)
    const map = useRef<MapLibreMap | null>(null)
    const selectedLineRef = useRef<string | null>(null)
    const listenersAttached = useRef(false)
    const scenario = useStore(appStore, (state) => state.scenario)
    const selectedLine = useStore(appStore, (state) => state.selectedLine)
    const [basemapId, setBasemapId] = useState(DEFAULT_BASEMAP_ID)

    // Built once per scenario load, not per frame: `PatternGeometry`'s whole reason to exist is
    // to make `vehiclesAt` cheap to call every animation frame, which it can't be if this walk
    // over every pattern's polyline and every line's colour re-runs on each of those calls.
    const vehicleContext = useMemo<VehicleGeometryContext | null>(() => {
        if (!scenario) {
            return null
        }
        const geometries = new Map(
            scenario.geometry.features.map((feature) => [feature.properties.patternId, buildPatternGeometry(feature)]),
        )
        const colorsByLine = new Map<string, LineDisplayColors>()
        for (const feature of scenario.geometry.features) {
            if (!colorsByLine.has(feature.properties.lineId)) {
                const line = scenario.index.lines.get(feature.properties.lineId)
                colorsByLine.set(feature.properties.lineId, {
                    color: feature.properties.color,
                    textColor: line?.textColor ?? '#ffffff',
                })
            }
        }
        return { geometries, colorsByLine }
    }, [scenario])

    useEffect(() => {
        if (map.current || !container.current) {
            return
        }
        map.current = new MapLibreMap({
            container: container.current,
            style: BASEMAP_STYLE,
            center: BRECLAV_CENTER,
            zoom: INITIAL_ZOOM,
        })
        map.current.addControl(new NavigationControl(), 'top-right')

        const instance = map.current
        const node = container.current

        // `idle` alone is not a reliable "the map genuinely rendered data" signal any more: the
        // clock now autoplays from the moment the app loads (see `App.tsx`), and while it plays,
        // the vehicle-position effect below calls `setData()` on the `vehicles` source on every
        // animation frame. That is continuous pending work by MapLibre's own definition of the
        // word, so `idle` — "no camera transition and no source has outstanding work" — can go
        // unfired indefinitely while vehicles are moving, even though the map is rendering
        // correctly the whole time (confirmed: `render` keeps firing, `routes`' own `sourcedata`
        // still reports loaded, the container and canvas are never zero-sized — only `idle`
        // itself never arrives). `sourcedata` events scoped to the `routes` source specifically
        // are what `updateRoutesRendered` actually needs — "did that one source finish loading" —
        // and they fire independently of the vehicles source's unrelated per-frame churn: once on
        // the initial load, and again after a basemap switch's `setStyle` discards the source and
        // `installLayers` re-adds it, which is exactly the "recovers once reinstalled" behaviour
        // the `idle` listener below was already relying on. Both listeners stay: `idle` still
        // catches genuinely idle moments (e.g. before the clock's first frame, or while paused),
        // `sourcedata` is what makes the attribute update reliably while the clock keeps playing.
        const onIdle = () => {
            updateRoutesRendered(instance, node)
            updateVehiclesRendered(instance, node)
        }
        instance.on('idle', onIdle)

        const onRoutesSourceData = (event: MapSourceDataEvent) => {
            if (event.sourceId === 'routes' && event.isSourceLoaded) {
                updateRoutesRendered(instance, node)
            }
        }
        instance.on('sourcedata', onRoutesSourceData)

        // Scoped to the `vehicles` source the same way `onRoutesSourceData` is scoped to `routes`
        // — this is what lets a Playwright test observe the vehicle count settle after a paused
        // deep link's single `setData` call, without waiting on `idle` (which a *playing* clock's
        // continuous per-frame `setData` calls can starve indefinitely, per the comment above).
        const onVehiclesSourceData = (event: MapSourceDataEvent) => {
            if (event.sourceId === 'vehicles') {
                updateVehiclesRendered(instance, node)
            }
        }
        instance.on('sourcedata', onVehiclesSourceData)

        return () => {
            instance.off('idle', onIdle)
            instance.off('sourcedata', onRoutesSourceData)
            instance.off('sourcedata', onVehiclesSourceData)
            map.current?.remove()
            map.current = null
        }
    }, [])

    // Delegated event listeners (attachInteractions) are bound to the Map instance itself, not
    // to a particular style's layers — MapLibre re-checks `getLayer` by id each time the event
    // fires, so they keep working across `setStyle()` without being re-attached. installLayers,
    // by contrast, must re-run every time, since it recreates the sources and layers a style
    // switch discarded.
    useEffect(() => {
        const instance = map.current
        if (!instance || !scenario) {
            return
        }

        // A scenario switch (as opposed to the first load, or a basemap change that just
        // `setStyle`'d the sources away) leaves `routes` and `stops` already installed, so
        // `installLayers` below would just no-op and the map would keep showing the previous
        // network forever. Push the new data into them directly, once, right here — not from the
        // `styledata`-triggered `install` below, which fires on every render frame while vehicles
        // animate (each of their own per-frame `setData` calls marks the style "changed") and
        // must stay a cheap no-op on every one of those firings, not repeat this work 60x/s. Badge
        // images need the same one-off treatment: `installLayers`'s own `installBadgeImages` call
        // never runs on this path (its "routes already exists" guard returns before reaching it),
        // so a scenario that introduces a line the previous one never had would otherwise leave
        // that line's vehicles with no badge image to look up.
        if (instance.getSource('routes')) {
            updateScenarioSources(instance, scenario)
            if (vehicleContext) {
                installBadgeImages(instance, vehicleContext.colorsByLine)
            }
        }

        const install = () => {
            // Computed fresh on every call (not hoisted above `install`): this only actually
            // matters on the one call that goes on to install anything (`installLayers` no-ops
            // every other time), but `clock.getState()` is cheap and correctness here depends on
            // reading the clock at the moment the source is created, not at whatever earlier
            // moment `install` happened to be registered.
            const clockState = clock.getState()
            const initialVehicles = vehicleContext
                ? vehicleFeatureCollection(scenario, vehicleContext, clockState.date, clockState.minutes)
                : emptyVehicleFeatureCollection()
            if (!installLayers(instance, scenario, initialVehicles, vehicleContext?.colorsByLine ?? new Map())) {
                return
            }
            if (!listenersAttached.current) {
                attachInteractions(instance)
                listenersAttached.current = true
            }
            applySelection(instance, scenario, selectedLineRef.current)
        }

        if (instance.isStyleLoaded()) {
            install()
        } else {
            instance.once('load', install)
        }
        instance.on('styledata', install)

        return () => {
            // Without this, a superseded run's `install` — bound to whichever `scenario` was
            // current when this effect last ran — stays queued on `load`. MapLibre's `Evented.off`
            // removes a listener from both its ordinary and one-time listener lists (see
            // `evented.ts`), so this is enough to cancel a still-pending `once('load', install)`
            // even though `once` itself returns no unsubscribe handle. Left unremoved, a scenario
            // switch that lands before the map's first `load` would let the stale `install` win
            // the `installLayers` "routes source already exists" guard race on that eventual
            // `load`, so the map would keep drawing the first scenario while the sidebar, the
            // vehicles and the URL had already moved on to the new one.
            instance.off('load', install)
            instance.off('styledata', install)
        }
    }, [scenario, vehicleContext])

    useEffect(() => {
        selectedLineRef.current = selectedLine
        const instance = map.current
        if (!instance || !scenario) {
            return
        }
        applySelection(instance, scenario, selectedLine)
    }, [scenario, selectedLine])

    // The one clock subscription for the whole map: called once per animation frame while
    // playing, so this must stay a direct, imperative `setData` — never `setState`, which would
    // re-render the whole component tree sixty times a second to move some dots. Re-subscribes
    // only when the scenario (and so `vehicleContext`) changes, not on every render. Guarding on
    // `getSource('vehicles')` is what makes a basemap switch mid-playback harmless: `setStyle`
    // discards the source until `installLayers` re-adds it, and frames that land in that gap are
    // simply skipped rather than throwing — the very next frame after `installLayers` reruns
    // finds the source again and vehicles resume moving.
    useEffect(() => {
        const instance = map.current
        if (!instance || !scenario || !vehicleContext) {
            return
        }
        return clock.subscribe((clockState: ClockState) => {
            const source = instance.getSource('vehicles')
            if (!source) {
                return
            }
            const data = vehicleFeatureCollection(scenario, vehicleContext, clockState.date, clockState.minutes)
            ;(source as GeoJSONSource).setData(data)
        })
    }, [scenario, vehicleContext])

    const handleBasemapChange = (id: string) => {
        const option = BASEMAPS.find((basemap) => basemap.id === id)
        const instance = map.current
        if (!option || !instance) {
            return
        }
        setBasemapId(id)
        instance.setStyle(option.style)
    }

    return (
        <>
            <div ref={container} className="h-full w-full" />
            <BasemapSwitcher current={basemapId} onChange={handleBasemapChange} />
        </>
    )
}
