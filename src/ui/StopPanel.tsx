import { X } from 'lucide-react'
import { useStore } from '@tanstack/react-store'
import { departuresAt } from '../domain/departures'
import { formatMinutes } from '../domain/formatMinutes'
import { appStore, selectLine, selectStop } from '../state/store'
import { LineBadge } from './LineBadge'
import { TimeControl } from './TimeControl'

export const StopPanel = () => {
    const scenario = useStore(appStore, (state) => state.scenario)
    const selectedStop = useStore(appStore, (state) => state.selectedStop)
    const date = useStore(appStore, (state) => state.date)
    const minutes = useStore(appStore, (state) => state.minutes)

    if (scenario === null || selectedStop === null) {
        return null
    }

    const stop = scenario.index.stops.get(selectedStop)
    if (!stop) {
        return null
    }

    const lines = scenario.index.linesByStop.get(selectedStop) ?? []
    const departures = departuresAt(scenario.index, selectedStop, date, minutes)

    const metaParts: string[] = []
    if (stop.zone) {
        metaParts.push(`Zóna ${stop.zone}`)
    }
    if (stop.wheelchair) {
        metaParts.push('bezbariérová')
    }

    return (
        <div className="z-10 m-3 flex max-h-[70vh] w-auto min-w-[260px] flex-col overflow-y-auto rounded-md border border-slate-200 bg-white p-3 shadow-lg sm:absolute sm:top-3 sm:right-3 sm:m-0 sm:max-h-[calc(100%-1.5rem)] sm:w-[320px]">
            <div className="flex items-start justify-between gap-2">
                <h2 className="text-base font-semibold">{stop.name}</h2>
                <button
                    type="button"
                    onClick={() => selectStop(null)}
                    aria-label="Zavřít"
                    className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-slate-100"
                >
                    <X className="size-4" />
                </button>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
                {metaParts.length > 0 ? metaParts.join(' · ') : 'Zóna neuvedena'}
            </p>

            {lines.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                    {lines.map((line) => (
                        <button key={line.id} type="button" onClick={() => selectLine(line.id)}>
                            <LineBadge line={line} />
                        </button>
                    ))}
                </div>
            )}

            <div className="mt-3 border-t border-slate-200 pt-2">
                <TimeControl />
            </div>

            <div className="mt-3">
                {departures.length === 0 ? (
                    <p className="text-sm text-slate-600">V tuto dobu odsud nic nejede.</p>
                ) : (
                    <table className="w-full border-collapse text-sm">
                        <tbody>
                            {departures.map((departure, i) => {
                                const line = scenario.index.lines.get(departure.lineId)
                                return (
                                    <tr key={`${departure.patternId}-${departure.serviceDate}-${departure.time}-${i}`}>
                                        <td className="py-0.5 pr-2 font-mono tabular-nums">
                                            {formatMinutes(departure.time)}
                                        </td>
                                        <td className="py-0.5 pr-2">
                                            {line ? <LineBadge line={line} /> : departure.lineName}
                                        </td>
                                        <td className="truncate py-0.5">{departure.headsign}</td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    )
}
