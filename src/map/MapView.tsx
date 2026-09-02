import { MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import { useStore } from '@tanstack/react-store'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { appStore, selectStop } from '../state/store'
import { BASEMAP_STYLE, BRECLAV_CENTER, DIM_COLOR, INITIAL_ZOOM, NO_LINE } from './style'
import type { FeatureCollection, Point } from 'geojson'
import type { Scenario } from '../data/loadScenario'

// maplibre-gl computes its worker script's URL at runtime relative to its own bundled
// location, which bundlers can't statically rewrite. Routing the worker file through Vite's
// `?worker&url` pipeline emits a self-contained chunk (with its internal shared-code import
// resolved), and pointing maplibre-gl at that URL up front avoids the broken default lookup —
// otherwise the worker 404s (dev) or silently fails to start (production build) and the map
// never draws anything past the basemap background.
setWorkerUrl(workerUrl)

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

export const MapView = () => {
    const container = useRef<HTMLDivElement>(null)
    const map = useRef<MapLibreMap | null>(null)
    const scenario = useStore(appStore, (state) => state.scenario)
    const selectedLine = useStore(appStore, (state) => state.selectedLine)

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

    useEffect(() => {
        const instance = map.current
        if (!instance || !scenario) {
            return
        }

        const install = () => {
            if (instance.getSource('routes')) {
                return
            }

            instance.addSource('routes', { type: 'geojson', data: scenario.geometry })
            instance.addSource('stops', { type: 'geojson', data: stopsGeoJson(scenario) })

            instance.addLayer({
                id: 'routes-dim',
                type: 'line',
                source: 'routes',
                filter: ['==', ['get', 'lineId'], NO_LINE],
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: { 'line-color': DIM_COLOR, 'line-width': 2 },
            })
            instance.addLayer({
                id: 'routes-active',
                type: 'line',
                source: 'routes',
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                    'line-color': ['get', 'color'],
                    'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 4, 17, 7],
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

        if (instance.isStyleLoaded()) {
            install()
        } else {
            instance.once('load', install)
        }
    }, [scenario])

    useEffect(() => {
        const instance = map.current
        if (!instance?.getLayer('routes-active')) {
            return
        }

        if (selectedLine === null) {
            instance.setFilter('routes-active', null)
            instance.setFilter('routes-dim', ['==', ['get', 'lineId'], NO_LINE])
        } else {
            instance.setFilter('routes-active', ['==', ['get', 'lineId'], selectedLine])
            instance.setFilter('routes-dim', ['!=', ['get', 'lineId'], selectedLine])
        }
    }, [selectedLine])

    return <div ref={container} className="h-full w-full" />
}
