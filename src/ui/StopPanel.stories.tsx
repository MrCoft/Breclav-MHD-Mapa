import { buildIndex } from '../data/buildIndex'
import { selectLine, selectStop, setMoment, setScenario } from '../state/store'
import { StopPanel } from './StopPanel'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { Scenario } from '../data/loadScenario'
import type { Network } from '../types/network'

// A small hand-built network, not the real scenario data, so the story renders offline and
// instantly, the same approach LineBrowser.stories.tsx uses. Trips only run in the daytime
// (no post-midnight starts), so a weekend date reliably has zero departures without depending
// on service-exception details.
const network: Network = {
    stops: [
        { id: 'a', name: 'Břeclav, aut.nádr.', lat: 48.7546, lon: 16.8932, zone: '575', wheelchair: true },
        { id: 'b', name: 'Břeclav, Poštorná', lat: 48.7402, lon: 16.8871, zone: '575' },
    ],
    lines: [
        {
            id: '561',
            name: '561',
            longName: 'Břeclav, aut.nádr. - Charvátská Nová Ves',
            mode: 'bus',
            color: '#2C89C8',
            textColor: '#FFFFFF',
        },
        {
            id: '563',
            name: '563',
            longName: 'Břeclav: Aut. nádraží - Poštorná, FOSFA',
            mode: 'bus',
            color: '#8A2C89',
            textColor: '#FFFFFF',
        },
    ],
    patterns: [
        {
            id: '561-0-1',
            line: '561',
            direction: 0,
            headsign: 'Charvátská Nová Ves',
            stops: ['a', 'b'],
            offsets: [0, 6],
        },
        {
            id: '563-0-1',
            line: '563',
            direction: 0,
            headsign: 'Poštorná, FOSFA',
            stops: ['a', 'b'],
            offsets: [0, 4],
        },
    ],
    services: [{ id: 'weekday', days: [1, 1, 1, 1, 1, 0, 0], from: '2026-01-01', to: '2026-12-31' }],
    trips: [
        { pattern: '561-0-1', service: 'weekday', start: 480 },
        { pattern: '561-0-1', service: 'weekday', start: 540 },
        { pattern: '563-0-1', service: 'weekday', start: 495 },
        { pattern: '563-0-1', service: 'weekday', start: 560 },
    ],
}

const scenario: Scenario = {
    id: 'storybook',
    index: buildIndex(network),
    meta: {
        feedDate: '2026-01-01',
        generatedAt: '2026-01-01T00:00:00Z',
        converterVersion: 'storybook',
        geometrySources: { osm: 0, routed: 0, straight: 0, override: 0 },
    },
    geometry: { type: 'FeatureCollection', features: [] },
}

const meta: Meta<typeof StopPanel> = {
    component: StopPanel,
    title: 'Components/StopPanel',
    decorators: [
        (Story) => (
            // StopPanel floats top-right of its nearest positioned ancestor; this box stands in
            // for the map wrapper it's normally rendered inside.
            <div style={{ position: 'relative', height: '480px', background: '#e7ebef' }}>
                <Story />
            </div>
        ),
    ],
}

export default meta
type Story = StoryObj<typeof StopPanel>

export const WithDepartures: Story = {
    decorators: [
        (Story) => {
            setScenario(scenario)
            selectLine(null)
            selectStop('a')
            // Wednesday, 07:50 — before every trip above, so all four show up in time order.
            setMoment('2026-01-07', 470)
            return <Story />
        },
    ],
}

export const NoDepartures: Story = {
    decorators: [
        (Story) => {
            setScenario(scenario)
            selectLine(null)
            selectStop('a')
            // Saturday — the only service is weekday-only, and no trip starts past midnight,
            // so nothing spills over from Friday either. Exercises the empty-state copy.
            setMoment('2026-01-10', 470)
            return <Story />
        },
    ],
}
