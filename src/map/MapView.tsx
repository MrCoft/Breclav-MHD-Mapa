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
import type { DataDrivenPropertyValueSpecification, GeoJSONSource } from 'maplibre-gl'
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

const VEHICLE_RADIUS: DataDrivenPropertyValueSpecification<number> = ['interpolate', ['linear'], ['zoom'], 11, 5, 15, 9]
const VEHICLE_TEXT_SIZE: DataDrivenPropertyValueSpecification<number> = [
    'interpolate',
    ['linear'],
    ['zoom'],
    11,
    8,
    15,
    11,
]

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
 * stops-selected-circle, stops-label, vehicles-circle, vehicles-label.
 */
function installLayers(instance: MapLibreMap, scenario: Scenario): boolean {
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

    // Starts empty: the clock subscription in `MapView` populates this with `setData` on the
    // very next frame (`clock.subscribe` calls its listener immediately on registration), so
    // there's no visible flash of an empty map before the first real vehicle positions land.
    instance.addSource('vehicles', { type: 'geojson', data: emptyVehicleFeatureCollection() })
    instance.addLayer({
        id: 'vehicles-circle',
        type: 'circle',
        source: 'vehicles',
        paint: {
            'circle-radius': VEHICLE_RADIUS,
            'circle-color': ['get', 'color'],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-opacity': 1,
            'circle-stroke-opacity': 1,
        },
    })
    instance.addLayer({
        id: 'vehicles-label',
        type: 'symbol',
        source: 'vehicles',
        layout: {
            'text-field': ['get', 'lineName'],
            'text-font': VEHICLE_TEXT_FONT,
            'text-size': VEHICLE_TEXT_SIZE,
            // Vehicles are few (67 at peak) and keep moving, so MapLibre's default collision
            // avoidance would make labels flicker in and out as they jostle for space — always
            // showing every line number is worth more here than tidy label placement.
            'text-allow-overlap': true,
            'text-ignore-placement': true,
        },
        paint: {
            'text-color': ['get', 'textColor'],
            'text-opacity': 1,
        },
    })

    return true
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
    // layers, same as the filters above, never a `setData` rebuild of the `vehicles` source.
    if (instance.getLayer('vehicles-circle')) {
        const opacity = vehicleOpacity(selectedLine)
        instance.setPaintProperty('vehicles-circle', 'circle-opacity', opacity)
        instance.setPaintProperty('vehicles-circle', 'circle-stroke-opacity', opacity)
        instance.setPaintProperty('vehicles-label', 'text-opacity', opacity)
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

        // Re-read on every idle, not just once: a basemap switch (`setStyle`) discards the
        // `routes` source until `installLayers` re-adds it, so re-checking here is what makes
        // the attribute drop back to zero for the span where the network is genuinely gone, and
        // recover once it's reinstalled — matching the count to the map's real state at all
        // times rather than a one-shot check that could go stale.
        const instance = map.current
        const node = container.current
        const onIdle = () => updateRoutesRendered(instance, node)
        instance.on('idle', onIdle)

        return () => {
            instance.off('idle', onIdle)
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

        const install = () => {
            if (!installLayers(instance, scenario)) {
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
            instance.off('styledata', install)
        }
    }, [scenario])

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
