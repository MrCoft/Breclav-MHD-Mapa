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

export async function loadScenario(id: string, fetchImpl: typeof fetch = fetch): Promise<Scenario> {
    const [network, meta, geometry] = await Promise.all([
        getJson<Network>(dataUrl(`${id}/network.json`), fetchImpl),
        getJson<Meta>(dataUrl(`${id}/meta.json`), fetchImpl),
        getJson<FeatureCollection<LineString, PatternProperties>>(dataUrl(`${id}/geometry.geojson`), fetchImpl),
    ])

    validateNetwork(network)
    return { id, index: buildIndex(network), meta, geometry }
}
