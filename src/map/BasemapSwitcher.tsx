import { Layers } from 'lucide-react'
import { useState } from 'react'
import { BASEMAPS } from './basemaps'

const OPTION_CLASS = (isCurrent: boolean) =>
    `rounded px-2 py-1 text-left ${isCurrent ? 'bg-accent text-accent-foreground' : 'text-slate-600 hover:bg-slate-100'}`

export const BasemapSwitcher = ({ current, onChange }: { current: string; onChange: (id: string) => void }) => {
    const [expanded, setExpanded] = useState(false)

    return (
        <div className="absolute top-3 left-3 z-10">
            {/* md and up: the full row of labelled choices, as before. */}
            <div className="hidden gap-1 rounded-md border border-slate-200 bg-white p-1 text-xs shadow-lg md:flex">
                {BASEMAPS.map((basemap) => (
                    <button
                        key={basemap.id}
                        type="button"
                        aria-pressed={basemap.id === current}
                        onClick={() => onChange(basemap.id)}
                        className={OPTION_CLASS(basemap.id === current)}
                    >
                        {basemap.label}
                    </button>
                ))}
            </div>

            {/* Below md: the row would eat into the map, so it collapses to one icon button that
                expands into the same choices — never more screen than the user actually asked for. */}
            <div className="md:hidden">
                <button
                    type="button"
                    aria-label="Podklad mapy"
                    aria-expanded={expanded}
                    onClick={() => setExpanded((value) => !value)}
                    className="flex size-11 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 shadow-lg"
                >
                    <Layers className="size-5" />
                </button>
                {expanded && (
                    <div className="mt-1 flex flex-col gap-1 rounded-md border border-slate-200 bg-white p-1 text-xs shadow-lg">
                        {BASEMAPS.map((basemap) => (
                            <button
                                key={basemap.id}
                                type="button"
                                aria-pressed={basemap.id === current}
                                onClick={() => {
                                    onChange(basemap.id)
                                    setExpanded(false)
                                }}
                                className={OPTION_CLASS(basemap.id === current)}
                            >
                                {basemap.label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
