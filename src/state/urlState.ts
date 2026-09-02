import { formatMinutes, parseMinutes } from '../domain/formatMinutes'
import type { AppState } from './store'

/** The subset of app state that lives in the query string, so any view is linkable. */
export type UrlState = Pick<AppState, 'scenarioId' | 'selectedLine' | 'selectedStop' | 'date' | 'minutes'>

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Parses `?s=…&line=…&stop=…&d=…&t=…` into whichever fields were present and well-formed. A
 * malformed date or time is dropped rather than surfacing as `NaN` — the caller (`App`) restores
 * date and time independently, so a bare `?t=07:30` with no `?d=` is a valid, unambiguous link.
 */
export function readUrlState(search: string): Partial<UrlState> {
    const params = new URLSearchParams(search)
    const state: Partial<UrlState> = {}

    const scenarioId = params.get('s')
    if (scenarioId !== null) {
        state.scenarioId = scenarioId
    }

    const selectedLine = params.get('line')
    if (selectedLine !== null) {
        state.selectedLine = selectedLine
    }

    const selectedStop = params.get('stop')
    if (selectedStop !== null) {
        state.selectedStop = selectedStop
    }

    const date = params.get('d')
    if (date !== null && DATE_PATTERN.test(date)) {
        state.date = date
    }

    const time = params.get('t')
    if (time !== null) {
        const minutes = parseMinutes(time)
        if (minutes !== null) {
            state.minutes = minutes
        }
    }

    return state
}

/** Serialises the full state that makes a view linkable. Null selections are omitted. */
export function writeUrlState(state: UrlState): string {
    const params = new URLSearchParams()
    params.set('s', state.scenarioId)
    if (state.selectedLine !== null) {
        params.set('line', state.selectedLine)
    }
    if (state.selectedStop !== null) {
        params.set('stop', state.selectedStop)
    }
    params.set('d', state.date)
    params.set('t', formatMinutes(state.minutes))
    return `?${params.toString()}`
}
