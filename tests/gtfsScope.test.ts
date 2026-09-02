import { describe, expect, it } from 'vitest'
import { assignStopIds, buildParentMap, municipalityOf, slugify } from '../scripts/gtfs/scope'
import type { GtfsStopRow } from '../scripts/gtfs/scope'

const rows: GtfsStopRow[] = [
    {
        stop_id: 'U15729N402',
        stop_name: 'Břeclav, autobusové nádraží',
        stop_lat: '48.754552',
        stop_lon: '16.893169',
        zone_id: '',
        location_type: '1',
        parent_station: '',
        wheelchair_boarding: '1',
        platform_code: '',
    },
    {
        stop_id: 'U15729Z15',
        stop_name: 'Břeclav, autobusové nádraží',
        stop_lat: '48.753851',
        stop_lon: '16.893169',
        zone_id: '575',
        location_type: '0',
        parent_station: 'U15729N402',
        wheelchair_boarding: '1',
        platform_code: '',
    },
    {
        stop_id: 'U15729Z14',
        stop_name: 'Břeclav, autobusové nádraží',
        stop_lat: '48.753851',
        stop_lon: '16.893169',
        zone_id: '575',
        location_type: '0',
        parent_station: 'U15729N402',
        wheelchair_boarding: '1',
        platform_code: '',
    },
    {
        stop_id: 'U99N1',
        stop_name: 'Lednice, zámek',
        stop_lat: '48.801',
        stop_lon: '16.805',
        zone_id: '',
        location_type: '1',
        parent_station: '',
        wheelchair_boarding: '0',
        platform_code: '',
    },
]

describe('municipalityOf', () => {
    it('takes the part before the first comma', () => {
        expect(municipalityOf('Břeclav, autobusové nádraží')).toBe('Břeclav')
    })

    it('returns the whole name when there is no comma', () => {
        expect(municipalityOf('Břeclav')).toBe('Břeclav')
    })

    it('trims surrounding whitespace', () => {
        expect(municipalityOf(' Břeclav , Poštorná')).toBe('Břeclav')
    })
})

describe('buildParentMap', () => {
    it('maps a platform to its parent station', () => {
        expect(buildParentMap(rows).get('U15729Z15')).toBe('U15729N402')
    })

    it('maps a parentless stop to itself', () => {
        expect(buildParentMap(rows).get('U99N1')).toBe('U99N1')
    })
})

describe('slugify', () => {
    it('strips Czech diacritics and punctuation', () => {
        expect(slugify('Břeclav, aut.nádr.')).toBe('breclav-aut-nadr')
    })

    it('collapses runs of separators', () => {
        expect(slugify('Lednice  --  zámek')).toBe('lednice-zamek')
    })
})

describe('assignStopIds', () => {
    it('produces readable, unique ids', () => {
        const ids = assignStopIds(rows.filter((r) => r.location_type === '1'))
        expect(ids.get('U15729N402')).toBe('breclav-autobusove-nadrazi')
        expect(ids.get('U99N1')).toBe('lednice-zamek')
    })

    it('disambiguates colliding slugs deterministically', () => {
        const dupes: GtfsStopRow[] = [
            { ...rows[0]!, stop_id: 'B', stop_name: 'Břeclav, škola' },
            { ...rows[0]!, stop_id: 'A', stop_name: 'Břeclav, Škola' },
        ]
        const ids = assignStopIds(dupes)
        // Sorted by GTFS id, so 'A' claims the bare slug regardless of input order.
        expect(ids.get('A')).toBe('breclav-skola')
        expect(ids.get('B')).toBe('breclav-skola-2')
    })
})
