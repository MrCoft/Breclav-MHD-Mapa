import { BASEMAPS } from './basemaps'

export const BasemapSwitcher = ({ current, onChange }: { current: string; onChange: (id: string) => void }) => {
    return (
        <div className="absolute top-3 left-3 z-10 flex gap-1 rounded-md border border-slate-200 bg-white p-1 text-xs shadow-lg">
            {BASEMAPS.map((basemap) => {
                const isCurrent = basemap.id === current
                return (
                    <button
                        key={basemap.id}
                        type="button"
                        aria-pressed={isCurrent}
                        onClick={() => onChange(basemap.id)}
                        className={`rounded px-2 py-1 ${
                            isCurrent ? 'bg-accent text-accent-foreground' : 'text-slate-600 hover:bg-slate-100'
                        }`}
                    >
                        {basemap.label}
                    </button>
                )
            })}
        </div>
    )
}
