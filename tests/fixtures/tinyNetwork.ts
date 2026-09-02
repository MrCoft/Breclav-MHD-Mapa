import type { Network } from '../../src/types/network'

export const tinyNetwork: Network = {
    stops: [
        { id: 'a', name: 'Břeclav, aut.nádr.', lat: 48.7546, lon: 16.8932, zone: '575', wheelchair: true },
        { id: 'b', name: 'Břeclav, Poštorná', lat: 48.7402, lon: 16.8871, zone: '575' },
        { id: 'c', name: 'Břeclav, FOSFA', lat: 48.7331, lon: 16.8825, zone: '575' },
    ],
    lines: [
        {
            id: '563',
            name: '563',
            longName: 'Břeclav: Aut. nádraží - Poštorná, FOSFA',
            mode: 'bus',
            color: '#2C89C8',
            textColor: '#FFFFFF',
        },
    ],
    patterns: [
        {
            id: '563-0-1',
            line: '563',
            direction: 0,
            headsign: 'Poštorná, FOSFA',
            stops: ['a', 'b', 'c'],
            offsets: [0, 4, 9],
        },
    ],
    services: [
        {
            id: 'weekday',
            days: [1, 1, 1, 1, 1, 0, 0],
            from: '2026-01-01',
            to: '2026-12-31',
            added: ['2026-09-05'],
            removed: ['2026-09-03'],
        },
        { id: 'weekend', days: [0, 0, 0, 0, 0, 1, 1], from: '2026-01-01', to: '2026-12-31' },
    ],
    trips: [
        { pattern: '563-0-1', service: 'weekday', start: 374 },
        { pattern: '563-0-1', service: 'weekday', start: 1450, offsets: [0, 3, 7] },
        { pattern: '563-0-1', service: 'weekend', start: 600 },
    ],
}
