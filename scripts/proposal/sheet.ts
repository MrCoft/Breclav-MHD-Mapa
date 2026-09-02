import { SKIPPED_MARKER, cellToMinutes } from './time'

/**
 * Splits one line sheet's raw cell grid into its direction sections.
 *
 * Each line sheet holds *two* stacked sections, not one: a `"Tč"` header row starts each, and
 * both reuse the same Excel columns (D, E, F, …) for their own, independent trip numbering — the
 * second section's header row is a second, later `"Tč"` row, easy to miss if a reader (as
 * `scripts/analysis/inspect_proposal.py` does, by design — it only ever surfaces the workbook's
 * quirks, not this structure) only ever looks for the first one. The first section is always the
 * line's outbound direction (0); the second is always its return (1) — confirmed by row order
 * (every stop sequence reverses between the two), and, where present, by the label row's own
 * "opačný směr" ("opposite direction") text. See `docs/proposal-import.md` for the full
 * structural survey this was built from.
 */

/** A sheet's cells as `"<row>:<column letters>"` -> raw text — see `proposal/xlsx.ts`. */
export type Grid = Map<string, string>

export interface StopRow {
    row: number
    name: string
    marker: string
}

export interface TripColumn {
    /** The trip number as printed in the sheet, e.g. `"33"` — not necessarily contiguous. */
    number: string
    column: string
}

export interface Section {
    headerRow: number
    tripColumns: TripColumn[]
    stops: StopRow[]
}

function cell(grid: Grid, row: number, column: string): string | undefined {
    return grid.get(`${row}:${column}`)
}

function rowsOf(grid: Grid): number[] {
    const rows = new Set<number>()
    for (const key of grid.keys()) {
        rows.add(Number(key.slice(0, key.indexOf(':'))))
    }
    return [...rows].sort((a, b) => a - b)
}

function columnsAtRow(grid: Grid, row: number): string[] {
    const prefix = `${row}:`
    const columns: string[] = []
    for (const key of grid.keys()) {
        if (key.startsWith(prefix)) {
            columns.push(key.slice(prefix.length))
        }
    }
    // Column letters sort by length first (A..Z before AA..AZ), then lexicographically.
    return columns.sort((a, b) => a.length - b.length || a.localeCompare(b))
}

export function findHeaderRows(grid: Grid): number[] {
    return rowsOf(grid).filter((row) => (cell(grid, row, 'A') ?? '').trim() === 'Tč')
}

/**
 * True for a row that is not really a stop — this workbook's per-trip distance totals, whose
 * label is usually `"km"` but is garbled to `"X+X50"` on one sheet (562's return section).
 * Detected structurally rather than by name: a real stop's populated cells are either literal
 * `HH:MM` text or an Excel day-fraction, which is always below 1 (a fraction *of one day*); a
 * distance total's cells are km figures, routinely 1 or more. A single stray value near that
 * boundary is not enough to call a row a summary row — a stop only a few minutes past midnight
 * would round to a fraction just over 0 either way — so this requires most of a row's populated
 * cells to clear it, not just one.
 */
function looksLikeSummaryRow(grid: Grid, row: number, tripColumns: TripColumn[]): boolean {
    let numeric = 0
    let tooLarge = 0
    for (const { column } of tripColumns) {
        const raw = cell(grid, row, column)
        if (raw === undefined || raw === SKIPPED_MARKER) {
            continue
        }
        if (/^\d{1,2}:\d{2}$/.test(raw.trim())) {
            continue // a literal time is definitely a real stop's cell
        }
        const value = Number(raw)
        if (Number.isNaN(value)) {
            continue
        }
        numeric += 1
        if (value >= 1.2) {
            tooLarge += 1
        }
    }
    return numeric > 0 && tooLarge / numeric > 0.5
}

export function parseSections(grid: Grid): Section[] {
    const headerRows = findHeaderRows(grid)
    const rows = rowsOf(grid)
    const lastRow = rows.at(-1) ?? 0

    return headerRows.map((headerRow, index) => {
        const nextHeaderRow = headerRows[index + 1] ?? lastRow + 1

        const tripColumns: TripColumn[] = columnsAtRow(grid, headerRow)
            .filter((column) => column !== 'A')
            .map((column) => ({ number: cell(grid, headerRow, column)!, column }))

        const stops: StopRow[] = []
        for (const row of rows) {
            if (row <= headerRow || row >= nextHeaderRow) {
                continue
            }
            const rawName = cell(grid, row, 'B')
            if (!rawName) {
                continue
            }
            // A real stop row always carries a sequence number in column A; the two kinds of
            // non-stop row this needs to skip — the per-trip "km" total and the "návrh k
            // projednání" ("proposal for consideration") direction-label row — never do.
            if (!cell(grid, row, 'A')) {
                continue
            }
            const name = rawName.trim()
            if (name === '' || name.toLowerCase() === 'km') {
                continue
            }
            if (looksLikeSummaryRow(grid, row, tripColumns)) {
                continue
            }
            stops.push({ row, name, marker: (cell(grid, row, 'C') ?? '').trim() })
        }

        return { headerRow, tripColumns, stops }
    })
}

/** A trip column's time at one stop row, or `undefined` if that trip skips (or never reaches) it. */
export function tripStopMinutes(grid: Grid, row: number, column: string): number | undefined {
    return cellToMinutes(cell(grid, row, column))
}
