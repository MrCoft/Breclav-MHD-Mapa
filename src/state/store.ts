import { Store } from '@tanstack/store'
import type { Scenario } from '../data/loadScenario'

export interface AppState {
    scenarioId: string
    scenario: Scenario | null
    error: string | null
    selectedLine: string | null
    selectedStop: string | null
    date: string
    minutes: number
}

/** Current wall-clock date and minute in Europe/Prague, regardless of the viewer's zone. */
export function nowInPrague(): { date: string; minutes: number } {
    const parts = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Prague',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(new Date())
    const get = (type: string) => parts.find((part) => part.type === type)!.value
    return {
        date: `${get('year')}-${get('month')}-${get('day')}`,
        minutes: Number(get('hour')) * 60 + Number(get('minute')),
    }
}

export const appStore = new Store<AppState>({
    scenarioId: 'current',
    scenario: null,
    error: null,
    selectedLine: null,
    selectedStop: null,
    ...nowInPrague(),
})

export function setScenarioId(scenarioId: string): void {
    appStore.setState((state) => ({ ...state, scenarioId }))
}

/**
 * Installs a freshly loaded scenario. In the same update, drops any line or stop selection that
 * doesn't exist in it — e.g. line 564 exists in "Současný stav" but not "Návrh 2026" — rather
 * than leaving a dangling id that would show an empty panel or a highlight matching nothing.
 */
export function setScenario(scenario: Scenario): void {
    appStore.setState((state) => ({
        ...state,
        scenario,
        error: null,
        selectedLine:
            state.selectedLine !== null && scenario.index.lines.has(state.selectedLine) ? state.selectedLine : null,
        selectedStop:
            state.selectedStop !== null && scenario.index.stops.has(state.selectedStop) ? state.selectedStop : null,
    }))
}

export function setError(error: string | null): void {
    appStore.setState((state) => ({ ...state, error }))
}

export function selectLine(selectedLine: string | null): void {
    appStore.setState((state) => ({ ...state, selectedLine }))
}

export function selectStop(selectedStop: string | null): void {
    appStore.setState((state) => ({ ...state, selectedStop }))
}

export function setMoment(date: string, minutes: number): void {
    appStore.setState((state) => ({ ...state, date, minutes }))
}
