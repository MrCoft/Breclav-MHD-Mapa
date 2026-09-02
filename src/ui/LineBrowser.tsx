import { useStore } from '@tanstack/react-store'
import { appStore, selectLine } from '../state/store'
import { LineBadge } from './LineBadge'
import type { Line, Mode } from '../types/network'

const GROUPS: { mode: Mode; label: string }[] = [
    { mode: 'bus', label: 'Autobusy' },
    { mode: 'rail', label: 'Vlaky' },
]

function sortedByName(lines: Line[]): Line[] {
    return [...lines].sort((a, b) => a.name.localeCompare(b.name, 'cs', { numeric: true }))
}

const LineGroup = ({ label, lines, selectedLine }: { label: string; lines: Line[]; selectedLine: string | null }) => {
    if (lines.length === 0) {
        return null
    }

    return (
        <section className="mt-3">
            <h2 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</h2>
            <ul className="flex flex-col gap-1">
                {lines.map((line) => {
                    const isSelected = line.id === selectedLine
                    return (
                        <li key={line.id}>
                            <button
                                type="button"
                                aria-pressed={isSelected}
                                onClick={() => selectLine(isSelected ? null : line.id)}
                                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${
                                    isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-slate-100'
                                }`}
                            >
                                <LineBadge line={line} />
                                <span className="truncate">{line.longName}</span>
                            </button>
                        </li>
                    )
                })}
            </ul>
        </section>
    )
}

export const LineBrowser = () => {
    const scenario = useStore(appStore, (state) => state.scenario)
    const selectedLine = useStore(appStore, (state) => state.selectedLine)

    if (scenario === null) {
        return null
    }

    const { lines, stops } = scenario.index.network

    return (
        <div>
            <h1 className="mb-1 text-base font-semibold">MHD Břeclav</h1>
            <p className="text-xs text-slate-500">
                {lines.length} linek, {stops.length} zastávek
            </p>
            {selectedLine !== null && (
                <button
                    type="button"
                    onClick={() => selectLine(null)}
                    className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
                >
                    Zobrazit všechny linky
                </button>
            )}
            {GROUPS.map((group) => (
                <LineGroup
                    key={group.mode}
                    label={group.label}
                    lines={sortedByName(lines.filter((line) => line.mode === group.mode))}
                    selectedLine={selectedLine}
                />
            ))}
        </div>
    )
}
