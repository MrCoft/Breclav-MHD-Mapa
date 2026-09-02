// Route colours come from the feed as flat, saturated hex values tuned for a print legend, not
// for sitting on a map next to a basemap. Some barely clear 1:1 contrast against white. Clamping
// HSL lightness into a fixed band was tried first and rejected — HSL lightness isn't perceptual,
// so a green and a blue at the same lightness read at very different brightness, and the clamp
// left pale colours pale. This targets WCAG contrast directly instead: darken only as far as
// needed to clear the target, preserving hue throughout.

interface Rgb {
    r: number
    g: number
    b: number
}

interface Hsl {
    h: number
    s: number
    l: number
}

const CONTRAST_TARGET = 3.5
const SATURATION_FLOOR = 0.55
/** Below this input saturation, treat the colour as grey rather than inventing a hue for it. */
const GREYSCALE_SATURATION_THRESHOLD = 0.05
const BINARY_SEARCH_ITERATIONS = 40
/** casingColor darkens the mapped colour to this fraction of its lightness. */
const CASING_LIGHTNESS_FACTOR = 0.55

function hexToRgb(hex: string): Rgb {
    const normalized = hex.replace('#', '')
    return {
        r: parseInt(normalized.slice(0, 2), 16),
        g: parseInt(normalized.slice(2, 4), 16),
        b: parseInt(normalized.slice(4, 6), 16),
    }
}

function clampByte(value: number): number {
    return Math.min(255, Math.max(0, Math.round(value)))
}

function rgbToHex({ r, g, b }: Rgb): string {
    const channel = (value: number) => clampByte(value).toString(16).padStart(2, '0')
    return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase()
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
    const rN = r / 255
    const gN = g / 255
    const bN = b / 255
    const max = Math.max(rN, gN, bN)
    const min = Math.min(rN, gN, bN)
    const l = (max + min) / 2
    const delta = max - min

    if (delta === 0) {
        return { h: 0, s: 0, l }
    }

    const s = delta / (1 - Math.abs(2 * l - 1))

    let h: number
    if (max === rN) {
        h = 60 * (((gN - bN) / delta) % 6)
    } else if (max === gN) {
        h = 60 * ((bN - rN) / delta + 2)
    } else {
        h = 60 * ((rN - gN) / delta + 4)
    }
    if (h < 0) {
        h += 360
    }

    return { h, s, l }
}

/** Returns fractional (unrounded) 0-255 channels — callers round once, at final output. */
function hslToRgb({ h, s, l }: Hsl): Rgb {
    if (s === 0) {
        const v = l * 255
        return { r: v, g: v, b: v }
    }

    const c = (1 - Math.abs(2 * l - 1)) * s
    const hp = h / 60
    const x = c * (1 - Math.abs((hp % 2) - 1))
    const m = l - c / 2

    let rp: number
    let gp: number
    let bp: number
    if (hp < 1) {
        ;[rp, gp, bp] = [c, x, 0]
    } else if (hp < 2) {
        ;[rp, gp, bp] = [x, c, 0]
    } else if (hp < 3) {
        ;[rp, gp, bp] = [0, c, x]
    } else if (hp < 4) {
        ;[rp, gp, bp] = [0, x, c]
    } else if (hp < 5) {
        ;[rp, gp, bp] = [x, 0, c]
    } else {
        ;[rp, gp, bp] = [c, 0, x]
    }

    return { r: (rp + m) * 255, g: (gp + m) * 255, b: (bp + m) * 255 }
}

function srgbChannelToLinear(channel: number): number {
    const c = channel / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(rgb: Rgb): number {
    return (
        0.2126 * srgbChannelToLinear(rgb.r) + 0.7152 * srgbChannelToLinear(rgb.g) + 0.0722 * srgbChannelToLinear(rgb.b)
    )
}

/** WCAG contrast ratio of `rgb` against opaque white. */
function contrastAgainstWhite(rgb: Rgb): number {
    return 1.05 / (relativeLuminance(rgb) + 0.05)
}

/**
 * Darkens `hex` only as far as needed to clear {@link CONTRAST_TARGET} against white, preserving
 * hue. Colours that already clear the target come back byte-identical. Saturation is raised to a
 * floor before the search so darkened colours still read as saturated route strokes rather than
 * murky greys — except for inputs that are already close to grey, where raising saturation would
 * invent a hue that was never there.
 *
 * Binary search runs a fixed number of iterations rather than looping until a condition holds:
 * lightness 0 is always black, which always clears the target, so the search cannot fail to
 * terminate — the fixed budget is just precision, not a correctness guard.
 */
export function mapColor(hex: string): string {
    const rgb = hexToRgb(hex)
    if (contrastAgainstWhite(rgb) >= CONTRAST_TARGET) {
        return hex
    }

    const hsl = rgbToHsl(rgb)
    const s = hsl.s < GREYSCALE_SATURATION_THRESHOLD ? 0 : Math.max(hsl.s, SATURATION_FLOOR)

    let lo = 0
    let hi = 1
    for (let i = 0; i < BINARY_SEARCH_ITERATIONS; i++) {
        const mid = (lo + hi) / 2
        if (contrastAgainstWhite(hslToRgb({ h: hsl.h, s, l: mid })) >= CONTRAST_TARGET) {
            lo = mid
        } else {
            hi = mid
        }
    }

    return rgbToHex(hslToRgb({ h: hsl.h, s, l: lo }))
}

/**
 * A darker outline for a mapped route colour: same hue and saturation, lightness scaled down by
 * {@link CASING_LIGHTNESS_FACTOR}. Intended to be called with `mapColor`'s output, so the casing
 * tracks whatever hue and saturation the line actually ends up drawn in.
 */
export function casingColor(hex: string): string {
    const hsl = rgbToHsl(hexToRgb(hex))
    return rgbToHex(hslToRgb({ h: hsl.h, s: hsl.s, l: hsl.l * CASING_LIGHTNESS_FACTOR }))
}
