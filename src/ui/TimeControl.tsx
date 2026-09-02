import { useStore } from '@tanstack/react-store'
import { formatMinutes, parseMinutes } from '../domain/formatMinutes'
import { clock } from '../state/clock'
import { appStore } from '../state/store'

/**
 * Date/time inputs for jumping straight to a moment. `date` and `minutes` are read from
 * `appStore`, which the clock mirrors on every whole-minute change — plenty granular for inputs
 * that only ever hold a whole minute. Every write goes through `clock.seek`, never `setMoment`
 * directly: the clock is the single source of truth for time, and `ClockControls`'s scrub slider
 * and this panel would silently disagree the moment a played-through minute here wasn't also
 * reflected there.
 */
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
                            clock.seek(event.target.value, minutes)
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
                        const parsed = parseMinutes(event.target.value)
                        if (parsed !== null) {
                            clock.seek(date, parsed)
                        }
                    }}
                    className="rounded border border-slate-300 px-1.5 py-1 font-mono text-sm text-slate-900 tabular-nums"
                />
            </label>
            <button
                type="button"
                onClick={() => clock.resetToNow()}
                className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
            >
                Teď
            </button>
        </div>
    )
}
