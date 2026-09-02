import { describe, expect, it } from 'vitest'
import { readUrlState, writeUrlState } from '../src/state/urlState'
import type { UrlState } from '../src/state/urlState'

const full: UrlState = {
    scenarioId: 'current',
    selectedLine: '563',
    selectedStop: 'breclav-autobusove-nadrazi',
    date: '2026-09-02',
    minutes: 450,
}

describe('writeUrlState', () => {
    it('serialises every field, in query order s, line, stop, d, t', () => {
        expect(writeUrlState(full)).toBe('?s=current&line=563&stop=breclav-autobusove-nadrazi&d=2026-09-02&t=07%3A30')
    })

    it('always includes scenario, date and time, but omits null selections', () => {
        const search = writeUrlState({ ...full, selectedLine: null, selectedStop: null })
        expect(search).toBe('?s=current&d=2026-09-02&t=07%3A30')
    })
})

describe('readUrlState', () => {
    it('gives an empty object for an empty query', () => {
        expect(readUrlState('')).toEqual({})
    })

    it('ignores a malformed date rather than writing NaN', () => {
        expect(readUrlState('?s=current&d=02-09-2026&t=07:30')).toEqual({ scenarioId: 'current', minutes: 450 })
        expect(readUrlState('?d=not-a-date')).toEqual({})
    })

    it('ignores a malformed time rather than writing NaN', () => {
        expect(readUrlState('?s=current&d=2026-09-02&t=7:30')).toEqual({ scenarioId: 'current', date: '2026-09-02' })
        expect(readUrlState('?t=not-a-time')).toEqual({})
    })

    it('restores a bare time with no date, unambiguously — the store defaults the date', () => {
        expect(readUrlState('?t=07:30')).toEqual({ minutes: 450 })
    })

    it('restores a bare date with no time', () => {
        expect(readUrlState('?d=2026-09-02')).toEqual({ date: '2026-09-02' })
    })

    it('round-trips every field through writeUrlState', () => {
        expect(readUrlState(writeUrlState(full))).toEqual(full)
    })
})
