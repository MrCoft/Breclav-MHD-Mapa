import { Pause, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { formatMinutes } from '../domain/formatMinutes'
import { CLOCK_SPEEDS, clock } from '../state/clock'
import type { ClockState } from '../state/clock'

/**
 * Formats a `YYYY-MM-DD` date in short Czech numeric style ("2. 9. 2026"), without letting the
 * viewer's timezone shift it by a day — the same anti-shift trick `Footer.formatFeedDate` uses:
 * building the `Date` from its parts keeps it anchored to local midnight, matching what
 * `Intl.DateTimeFormat` (no explicit `timeZone`) reads back.
 */
function formatDateShort(date: string): string {
    const [year, month, day] = date.split('-').map(Number)
    const parsed = new Date(year ?? 0, (month ?? 1) - 1, day ?? 1)
    return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }).format(parsed)
}

/** 44px in every dimension — the minimum touch target this task's brief calls for. */
const TOUCH_TARGET = 'min-h-[44px] min-w-[44px]'

const SLIDER_THUMB_CLASS =
    '[&::-webkit-slider-thumb]:h-[44px] [&::-webkit-slider-thumb]:w-[44px] [&::-webkit-slider-thumb]:appearance-none ' +
    '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white ' +
    '[&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:cursor-pointer ' +
    '[&::-moz-range-thumb]:h-[44px] [&::-moz-range-thumb]:w-[44px] [&::-moz-range-thumb]:appearance-none ' +
    '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white ' +
    '[&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:shadow [&::-moz-range-thumb]:cursor-pointer ' +
    '[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-slate-200 ' +
    '[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-slate-200'

/**
 * Play/pause, speed, a scrub slider across the service day, and the current moment — floating
 * over the map. Subscribes to `clock` directly rather than reading `appStore`: the store only
 * mirrors whole-minute changes, which would make the slider thumb and the digital clock stutter
 * once a simulated minute instead of moving smoothly while playing. Re-rendering this one small
 * component every animation frame is the cost of that smoothness — cheap, and confined to this
 * component alone, unlike a per-frame store write which would re-render every subscribed panel.
 */
export const ClockControls = () => {
    const [state, setState] = useState<ClockState>(() => clock.getState())

    useEffect(() => clock.subscribe(setState), [])

    const { date, minutes, playing, speed } = state
    // `minutes` is fractional (continuous motion needs that); every display here is whole-minute.
    const wholeMinutes = Math.floor(minutes)

    return (
        <div className="absolute inset-x-3 bottom-3 z-10 flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-2 shadow-lg sm:inset-x-auto sm:left-3 sm:w-[420px]">
            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={() => (playing ? clock.pause() : clock.play())}
                    aria-label={playing ? 'Pozastavit' : 'Přehrát'}
                    className={`flex shrink-0 items-center justify-center rounded-md border border-slate-300 hover:bg-slate-100 ${TOUCH_TARGET}`}
                >
                    {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
                </button>

                <div className="flex flex-col justify-center leading-tight">
                    <span className="font-mono text-xl tabular-nums">{formatMinutes(wholeMinutes)}</span>
                    <span className="text-xs text-slate-500">{formatDateShort(date)}</span>
                </div>

                <div className="ml-auto flex gap-1">
                    {CLOCK_SPEEDS.map((option) => (
                        <button
                            key={option}
                            type="button"
                            aria-pressed={option === speed}
                            onClick={() => clock.setSpeed(option)}
                            className={`rounded px-2 text-xs ${TOUCH_TARGET} ${
                                option === speed ? 'bg-accent text-accent-foreground' : 'hover:bg-slate-100'
                            }`}
                        >
                            {option}×
                        </button>
                    ))}
                </div>

                <button
                    type="button"
                    onClick={() => clock.resetToNow()}
                    className={`shrink-0 rounded border border-slate-300 px-3 text-xs hover:bg-slate-100 ${TOUCH_TARGET}`}
                >
                    Teď
                </button>
            </div>

            <input
                type="range"
                min={0}
                max={1439}
                step={1}
                value={wholeMinutes}
                onChange={(event) => clock.seek(date, Number(event.target.value))}
                aria-label="Posun v čase"
                className={`h-[44px] w-full touch-none appearance-none bg-transparent accent-primary ${SLIDER_THUMB_CLASS}`}
            />
        </div>
    )
}
