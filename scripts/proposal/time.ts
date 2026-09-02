/** A `~` marks a stop a trip does not serve — see `scripts/analysis/inspect_proposal.py`. */
export const SKIPPED_MARKER = '~'

// A genuine day-fraction is always comfortably below 1 (one day); this dataset has no trip that
// legitimately runs anywhere near 48 hours long, so a parsed value past that is not a time at
// all — it is data-entry noise. Found by hand: three trip columns on line 566's return section
// have the literal text "562" (very likely a stray line-number reference) in place of an arrival
// time; `Number('562')` is not `NaN`, so without this bound it would be accepted as 809,280
// minutes past midnight. Treated as not served, the same as a blank cell, rather than guessed —
// see `docs/proposal-import.md`.
const MAX_PLAUSIBLE_MINUTES = 48 * 60

/**
 * Excel day-fraction or literal `HH:MM` text to minutes after midnight; `undefined` for a
 * skipped (`~`), blank, whitespace-only, or otherwise unparseable cell. Mirrors `to_minutes` in
 * `scripts/analysis/inspect_proposal.py`, which already found the first two of these quirks in
 * the workbook: most times are Excel's own day-fraction floats, but a handful of cells are typed
 * in directly as literal `"H:MM"` text instead.
 *
 * Fractions are rounded to the nearest minute because the source's own arithmetic leaves long
 * floating tails — 0.21875 is exactly 05:15, but neighbouring cells in the same row carry
 * digits like `...99999999983`.
 */
export function cellToMinutes(cell: string | undefined): number | undefined {
    if (cell === undefined || cell === SKIPPED_MARKER || cell.trim() === '') {
        return undefined
    }
    const literal = /^(\d{1,2}):(\d{2})$/.exec(cell.trim())
    if (literal) {
        return Number(literal[1]) * 60 + Number(literal[2])
    }
    const fraction = Number(cell)
    if (Number.isNaN(fraction)) {
        return undefined
    }
    const minutes = Math.round(fraction * 1440)
    return minutes >= 0 && minutes <= MAX_PLAUSIBLE_MINUTES ? minutes : undefined
}
