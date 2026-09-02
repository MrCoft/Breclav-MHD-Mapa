import { describe, expect, it } from 'vitest'
import { casingColor, mapColor } from '../src/map/color'

function hexToRgb(hex: string): { r: number; g: number; b: number } {
    const normalized = hex.replace('#', '')
    return {
        r: parseInt(normalized.slice(0, 2), 16),
        g: parseInt(normalized.slice(2, 4), 16),
        b: parseInt(normalized.slice(4, 6), 16),
    }
}

describe('mapColor', () => {
    // Verified prototype output from the task 17 brief. These are literal expected values, not
    // re-derived from mapColor itself, so a regression in the algorithm will actually fail them.
    it('leaves a colour unchanged, byte-identical, when it already clears 3.5:1', () => {
        expect(mapColor('#2C89C8')).toBe('#2C89C8')
        expect(mapColor('#800000')).toBe('#800000')
    })

    it('darkens a pale green that fails contrast to the brief’s verified value', () => {
        expect(mapColor('#7FFFAA')).toBe('#009F35')
    })

    it('darkens a soft yellow that fails contrast to the brief’s verified value', () => {
        expect(mapColor('#E1CB31')).toBe('#9A8A16')
    })

    it('does not invent a hue for a near-grey input below the saturation guard', () => {
        // #D8DAD7 has saturation ~0.039, below the 0.05 guard, and fails 3.5:1 (~1.41:1).
        const result = mapColor('#D8DAD7')
        const { r, g, b } = hexToRgb(result)
        expect(r).toBe(g)
        expect(g).toBe(b)
    })

    it('raises saturation for an input just above the guard, producing a real hue', () => {
        // #CCCFC9 has saturation ~0.059, above the 0.05 guard, and fails 3.5:1 (~1.58:1).
        const result = mapColor('#CCCFC9')
        const { r, g, b } = hexToRgb(result)
        expect(r).not.toBe(g)
        expect(g).not.toBe(b)
    })

    it('terminates on pure white, darkening to a neutral grey rather than spinning', () => {
        const result = mapColor('#FFFFFF')
        const { r, g, b } = hexToRgb(result)
        expect(r).toBe(g)
        expect(g).toBe(b)
        expect(r).toBeLessThan(255)
    })

    it('terminates on pure black, which already clears contrast and stays black', () => {
        expect(mapColor('#000000')).toBe('#000000')
    })
})

describe('casingColor', () => {
    it('matches the brief’s verified casing for each already-good or mapped colour', () => {
        expect(casingColor('#2C89C8')).toBe('#184B6E')
        expect(casingColor('#800000')).toBe('#460000')
        expect(casingColor(mapColor('#7FFFAA'))).toBe('#00571D')
        expect(casingColor(mapColor('#E1CB31'))).toBe('#554C0C')
    })

    it('is darker than its input for every saturated colour in the table', () => {
        const inputs = ['#2C89C8', '#800000', mapColor('#7FFFAA'), mapColor('#E1CB31')]
        for (const input of inputs) {
            const inputRgb = hexToRgb(input)
            const casingRgb = hexToRgb(casingColor(input))
            const inputSum = inputRgb.r + inputRgb.g + inputRgb.b
            const casingSum = casingRgb.r + casingRgb.g + casingRgb.b
            expect(casingSum).toBeLessThan(inputSum)
        }
    })

    it('stays grey for a grey input, without inventing a hue', () => {
        const casing = casingColor('#898989')
        const { r, g, b } = hexToRgb(casing)
        expect(r).toBe(g)
        expect(g).toBe(b)
        expect(r).toBeLessThan(0x89)
    })

    it('cannot darken pure black further — the one input where casing is not strictly darker', () => {
        expect(casingColor('#000000')).toBe('#000000')
    })
})
