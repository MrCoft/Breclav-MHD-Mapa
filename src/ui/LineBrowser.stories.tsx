import { buildIndex } from '../data/buildIndex'
import { selectLine, setScenario } from '../state/store'
import { LineBrowser } from './LineBrowser'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { Scenario } from '../data/loadScenario'
import type { Network } from '../types/network'

// A small hand-built network, not the real scenario data, so the story renders offline and
// instantly. Line names are picked to show the numeric sort (563 before 570, S8 before S51)
// rather than a lexicographic one.
const network: Network = {
    stops: [
        { id: 'a', name: 'Břeclav, aut.nádr.', lat: 48.7546, lon: 16.8932 },
        { id: 'b', name: 'Břeclav, Poštorná', lat: 48.7402, lon: 16.8871 },
        { id: 'c', name: 'Břeclav, žel.st.', lat: 48.7597, lon: 16.8824 },
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
            color: '#2C89C8',
            textColor: '#FFFFFF',
        },
        {
            id: '570',
            name: '570',
            longName: 'Břeclav - Ladná - Lednice - Valtice',
            mode: 'bus',
            color: '#2C89C8',
            textColor: '#FFFFFF',
        },
        {
            id: 'S8',
            name: 'S8',
            longName: 'Břeclav - Brno hl.n. - Blansko',
            mode: 'rail',
            color: '#0D4C92',
            textColor: '#FFFFFF',
        },
        { id: 'S51', name: 'S51', longName: 'Břeclav - Znojmo', mode: 'rail', color: '#0D4C92', textColor: '#FFFFFF' },
    ],
    patterns: [],
    services: [],
    trips: [],
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

const meta: Meta<typeof LineBrowser> = {
    component: LineBrowser,
    title: 'Components/LineBrowser',
}

export default meta
type Story = StoryObj<typeof LineBrowser>

export const Default: Story = {
    decorators: [
        (Story) => {
            setScenario(scenario)
            selectLine(null)
            return <Story />
        },
    ],
}

export const LineSelected: Story = {
    decorators: [
        (Story) => {
            setScenario(scenario)
            selectLine('570')
            return <Story />
        },
    ],
}
