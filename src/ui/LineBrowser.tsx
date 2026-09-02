import { useStore } from '@tanstack/react-store'
import { appStore, selectLine } from '../state/store'
import { LineBadge } from './LineBadge'
import type { InheritedLines, Line, Mode } from '../types/network'

const GROUPS: { mode: Mode; label: string }[] = [
    { mode: 'bus', label: 'Autobusy' },
    { mode: 'rail', label: 'Vlaky' },
]

function sortedByName(lines: Line[]): Line[] {
    return [...lines].sort((a, b) => a.name.localeCompare(b.name, 'cs', { numeric: true }))
}

const LineGroup = ({
    label,
    lines,
    selectedLine,
    inheritedLines,
}: {
    label: string
    lines: Line[]
    selectedLine: string | null
    inheritedLines?: InheritedLines
}) => {
    if (lines.length === 0) {
        return null
    }

    return (
        <section className="mt-3">
            <h2 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</h2>
            <ul className="flex flex-col gap-1">
                {lines.map((line) => {
                    const isSelected = line.id === selectedLine
                    const isInherited = inheritedLines?.lines.includes(line.id) ?? false
                    return (
                        <li key={line.id}>
                            <button
                                type="button"
                                aria-pressed={isSelected}
                                onClick={() => selectLine(isSelected ? null : line.id)}
                                title={isInherited ? inheritedLines?.note : undefined}
                                className={`flex w-full items-center gap-2 rounded border-l-2 px-2 py-1 text-left text-sm ${
                                    isSelected
                                        ? 'border-primary bg-accent font-semibold text-accent-foreground'
                                        : 'border-transparent hover:bg-slate-100'
                                } ${isInherited ? 'opacity-70' : ''}`}
                            >
                                <LineBadge line={line} />
                                <span className="truncate">{line.longName}</span>
                                {isInherited && (
                                    <span className="ml-auto shrink-0 rounded bg-slate-200 px-1 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600 uppercase">
                                        Beze změny
                                    </span>
                                )}
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
    const inheritedLines = scenario.meta.inheritedLines

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
                    inheritedLines={inheritedLines}
                />
            ))}
            {/* Surfaces the same note the badge's title attribute carries, for anyone who won't
                hover a touch target — see the task brief's finding C3 and `Meta.inheritedLines`'s
                own doc comment in `types/network.ts`. */}
            {inheritedLines && (
                <p className="mt-3 text-xs text-slate-500">
                    Linky <strong>{inheritedLines.lines.join(', ')}</strong> („Beze změny“): {inheritedLines.note}
                </p>
            )}
        </div>
    )
}
