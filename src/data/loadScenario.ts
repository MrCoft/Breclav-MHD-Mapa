import { casingColor, mapColor } from '../map/color'
import { buildIndex } from './buildIndex'
import { validateNetwork } from './validate'
import type { FeatureCollection, LineString } from 'geojson'
import type { NetworkIndex } from './buildIndex'
import type { Meta, Network } from '../types/network'

export interface PatternProperties {
    patternId: string
    lineId: string
    lineName: string
    mode: string
    color: string
    /** A darker shade of `color`, for the casing line drawn beneath it. */
    casingColor: string
    source: string
    /** Metres along this feature's line at each of the pattern's stops. */
    stopDistances: number[]
}

export interface Scenario {
    id: string
    index: NetworkIndex
    meta: Meta
    geometry: FeatureCollection<LineString, PatternProperties>
}

/** The shape committed to `geometry.geojson` — the feed's true colour, before presentation adjustment. */
type FeedPatternProperties = Omit<PatternProperties, 'casingColor'>

function dataUrl(path: string): string {
    return `${import.meta.env.BASE_URL}data/${path}`
}

async function getJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
    const res = await fetchImpl(url)
    if (!res.ok) {
        throw new Error(`Nepodařilo se načíst ${url} (HTTP ${res.status})`)
    }
    return (await res.json()) as T
}

/**
 * Darkens each pattern's colour just enough to stay legible against the basemap and attaches a
 * matching casing colour, so the map's line layers can read both with `['get', …]`. Done here,
 * not in the committed data, so `geometry.geojson` keeps the feed's true colours and this stays a
 * presentation concern.
 */
function withMappedColors(
    geometry: FeatureCollection<LineString, FeedPatternProperties>,
): FeatureCollection<LineString, PatternProperties> {
    return {
        ...geometry,
        features: geometry.features.map((feature) => {
            const color = mapColor(feature.properties.color)
            return { ...feature, properties: { ...feature.properties, color, casingColor: casingColor(color) } }
        }),
    }
}

export async function loadScenario(id: string, fetchImpl: typeof fetch = fetch): Promise<Scenario> {
    const [network, meta, geometry] = await Promise.all([
        getJson<Network>(dataUrl(`${id}/network.json`), fetchImpl),
        getJson<Meta>(dataUrl(`${id}/meta.json`), fetchImpl),
        getJson<FeatureCollection<LineString, FeedPatternProperties>>(dataUrl(`${id}/geometry.geojson`), fetchImpl),
    ])

    validateNetwork(network)
    return { id, index: buildIndex(network), meta, geometry: withMappedColors(geometry) }
}
