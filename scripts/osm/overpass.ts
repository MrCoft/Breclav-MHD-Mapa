import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ScopeConfig } from '../gtfs/read'

export interface OsmNode {
    type: 'node'
    id: number
    lat: number
    lon: number
}

export interface OsmWay {
    type: 'way'
    id: number
    nodes: number[]
}

export interface OsmRelation {
    type: 'relation'
    id: number
    tags: Record<string, string>
    members: { type: string; ref: number; role: string }[]
}

export type OsmElement = OsmNode | OsmWay | OsmRelation

export interface OsmResponse {
    version: number
    generator: string
    elements: OsmElement[]
}

export function buildQuery(scope: ScopeConfig): string {
    const { minLat, minLon, maxLat, maxLon } = scope.bbox
    const bbox = `${minLat},${minLon},${maxLat},${maxLon}`
    // Real IDS JMK relations are tagged inconsistently: some carry the network's
    // abbreviation on `network` itself, others only on `network:short`, with `network`
    // holding the full Czech name instead. Matching either tag is what actually finds
    // Břeclav's own routes; matching `network` alone misses nearly all of them.
    return [
        '[out:json][timeout:300];',
        '(',
        `  relation["type"="route"]["network"~"${scope.osmNetwork}"](${bbox});`,
        `  relation["type"="route"]["network:short"~"${scope.osmNetwork}"](${bbox});`,
        ');',
        'out body;',
        '>;',
        'out skel qt;',
    ].join('\n')
}

/**
 * Returns every IDS JMK route relation in the bbox, from the committed cache
 * when present. Overpass is slow and rate-limited, so a cache miss is the
 * exception and `refresh` must be asked for explicitly.
 */
export async function fetchRoutes(
    scope: ScopeConfig,
    opts: { refresh?: boolean; cacheDir?: string } = {},
): Promise<OsmResponse> {
    const cacheDir = opts.cacheDir ?? 'data/cache/osm'
    const cachePath = join(cacheDir, 'routes.json')

    if (!opts.refresh && existsSync(cachePath)) {
        return JSON.parse(readFileSync(cachePath, 'utf8')) as OsmResponse
    }

    const res = await fetch(scope.overpassUrl, {
        method: 'POST',
        // overpass-api.de rejects requests with no User-Agent header with 406, per its usage policy
        // (https://wiki.openstreetmap.org/wiki/Overpass_API#Introduction). Node's fetch sends none by default.
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Breclav-MHD-Mapa/1.0 (+https://github.com/MrCoft/Breclav-MHD-Mapa)',
        },
        body: new URLSearchParams({ data: buildQuery(scope) }),
    })
    if (!res.ok) {
        throw new Error(`Overpass failed: ${res.status} ${res.statusText}`)
    }

    const body = (await res.json()) as OsmResponse
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(cachePath, `${JSON.stringify(body)}\n`, 'utf8')
    return body
}
