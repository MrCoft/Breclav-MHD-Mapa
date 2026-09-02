import { describe, expect, it } from 'vitest'
import { formatMinutes, parseMinutes } from '../src/domain/formatMinutes'

describe('formatMinutes', () => {
    it('formats a normal time', () => {
        expect(formatMinutes(374)).toBe('06:14')
    })

    it('wraps a time past midnight', () => {
        expect(formatMinutes(1460)).toBe('00:20')
    })
})

describe('parseMinutes', () => {
    it('parses a normal time', () => {
        expect(parseMinutes('06:14')).toBe(374)
    })

    it('rejects a malformed value instead of returning NaN', () => {
        expect(parseMinutes('6:14')).toBeNull()
        expect(parseMinutes('not-a-time')).toBeNull()
        expect(parseMinutes('')).toBeNull()
    })
})
