export function formatMinutes(minutes: number): string {
    const m = ((minutes % 1440) + 1440) % 1440
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

const TIME_PATTERN = /^(\d{2}):(\d{2})$/

/** Inverse of `formatMinutes`. Returns null for anything that isn't `HH:MM`, rather than `NaN`. */
export function parseMinutes(value: string): number | null {
    const match = TIME_PATTERN.exec(value)
    if (!match) {
        return null
    }
    return Number(match[1]) * 60 + Number(match[2])
}
