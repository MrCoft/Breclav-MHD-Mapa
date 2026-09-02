import { BASEMAP_STYLE } from './style'
import type { StyleSpecification } from 'maplibre-gl'

export interface BasemapOption {
    id: string
    label: string
    style: string | StyleSpecification
}

// Esri's World Imagery tile path is {z}/{y}/{x} — not the usual {z}/{x}/{y}. Getting that order
// wrong yields a scrambled map rather than an error, so it's worth calling out here.
const SATELLITE_STYLE: StyleSpecification = {
    version: 8,
    sources: {
        satellite: {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        },
    },
    layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
}

/**
 * Basemap choices for the switcher, decision 27. Keyless — Decision 1 puts the bundle on GitHub
 * Pages, where a keyed tile provider's key would be public. Terrain/hillshade are deliberately
 * not offered: Břeclav sits in the flat Dyje floodplain, so a DEM would show close to nothing.
 *
 * Two choices: a drawn map and satellite imagery — the familiar Google Maps pairing. "Mapa" is
 * `BASEMAP_STYLE` (see style.ts), the same constant the map boots into, so the switcher's first
 * entry and the app's default can never drift apart.
 */
export const BASEMAPS: BasemapOption[] = [
    { id: 'bright', label: 'Mapa', style: BASEMAP_STYLE },
    { id: 'satellite', label: 'Satelitní', style: SATELLITE_STYLE },
]

export const DEFAULT_BASEMAP_ID = 'bright'
