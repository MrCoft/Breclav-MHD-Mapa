import { useStore } from '@tanstack/react-store'
import { formatMinutes } from '../domain/formatMinutes'
import { appStore, nowInPrague, setMoment } from '../state/store'

const TIME_PATTERN = /^(\d{2}):(\d{2})$/

function parseTime(value: string): number | null {
    const match = TIME_PATTERN.exec(value)
    if (!match) {
        return null
    }
    const hours = Number(match[1])
    const mins = Number(match[2])
    if (Number.isNaN(hours) || Number.isNaN(mins)) {
        return null
    }
    return hours * 60 + mins
}

export const TimeControl = () => {
    const date = useStore(appStore, (state) => state.date)
    const minutes = useStore(appStore, (state) => state.minutes)

    return (
        <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5 text-xs text-slate-500">
                Datum
                <input
                    type="date"
                    value={date}
                    onChange={(event) => {
                        // A cleared date field reports an empty string; writing that would
                        // break every date-string comparison downstream, so ignore it.
                        if (event.target.value !== '') {
                            setMoment(event.target.value, minutes)
                        }
                    }}
                    className="rounded border border-slate-300 px-1.5 py-1 text-sm text-slate-900"
                />
            </label>
            <label className="flex flex-col gap-0.5 text-xs text-slate-500">
                Čas
                <input
                    type="time"
                    value={formatMinutes(minutes)}
                    onChange={(event) => {
                        const parsed = parseTime(event.target.value)
                        if (parsed !== null) {
                            setMoment(date, parsed)
                        }
                    }}
                    className="rounded border border-slate-300 px-1.5 py-1 font-mono text-sm text-slate-900 tabular-nums"
                />
            </label>
            <button
                type="button"
                onClick={() => {
                    const now = nowInPrague()
                    setMoment(now.date, now.minutes)
                }}
                className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
            >
                Teď
            </button>
        </div>
    )
}
