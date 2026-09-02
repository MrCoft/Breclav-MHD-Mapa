import { describe, expect, it } from 'vitest'
import { formatMinutes } from '../src/domain/formatMinutes'

describe('formatMinutes', () => {
    it('formats a normal time', () => {
        expect(formatMinutes(374)).toBe('06:14')
    })

    it('wraps a time past midnight', () => {
        expect(formatMinutes(1460)).toBe('00:20')
    })
})
