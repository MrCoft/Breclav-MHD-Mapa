import { MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '@tanstack/react-store'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { appStore, selectStop } from '../state/store'
import { BasemapSwitcher } from './BasemapSwitcher'
import { BASEMAPS, DEFAULT_BASEMAP_ID } from './basemaps'
import { BASEMAP_STYLE, BRECLAV_CENTER, DIM_COLOR, INITIAL_ZOOM, NO_LINE, SELECTED_STOP_COLOR } from './style'
import type { DataDrivenPropertyValueSpecification, GeoJSONSource } from 'maplibre-gl'
import type { FeatureCollection, Point } from 'geojson'
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
 * stops-selected-circle, stops-label.
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

    return true
}

/**
 * Re-applies the current line selection to the route filters and the selected-stops source.
 * Needed both on ordinary selection changes and after `installLayers` re-runs post basemap
 * switch, when the freshly re-added layers are back to their unfiltered defaults.
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

        return () => {
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
