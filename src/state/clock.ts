import { nowInPrague, setMoment } from './store'

/** Minutes since midnight at which a service day wraps to the next date. */
const MINUTES_PER_DAY = 1440

/** Multipliers offered by the UI. At 60x a whole service day passes in about 24 real minutes. */
export const CLOCK_SPEEDS = [1, 10, 60, 300] as const

export interface ClockState {
    date: string
    /** Fractional minutes since midnight of `date` — never rounded, so motion stays continuous. */
    minutes: number
    playing: boolean
    speed: number
}

export type ClockListener = (state: ClockState) => void

export interface Clock {
    getState: () => ClockState
    /**
     * Registers `listener`, calling it immediately with the current state (so a fresh subscriber
     * — the map after a scenario load, a newly mounted control — draws right away rather than
     * waiting for the next change), then again once per animation frame while playing and once on
     * any seek, play, pause or speed change. Returns an unsubscribe function; no further calls
     * reach `listener` after it runs.
     */
    subscribe: (listener: ClockListener) => () => void
    play: () => void
    pause: () => void
    setSpeed: (speed: number) => void
    seek: (date: string, minutes: number) => void
    resetToNow: () => void
}

export interface ClockOptions {
    /** Monotonic clock used to measure real elapsed time between frames. Defaults to `performance.now`. */
    now?: () => number
    /** Frame scheduler, injectable so tests can drive frames without real timers. Defaults to `requestAnimationFrame`. */
    scheduleFrame?: (callback: (time: number) => void) => number
    /** Cancels a handle returned by `scheduleFrame`. Defaults to `cancelAnimationFrame`. */
    cancelFrame?: (handle: number) => void
    /** Called at most once per distinct whole minute (date + floored minute), to mirror into external state. */
    onMinuteChange?: (date: string, minutes: number) => void
    /** Supplies "now" for `resetToNow`. Defaults to `nowInPrague`. */
    momentProvider?: () => { date: string; minutes: number }
    /** Starting date/minutes. Defaults to `momentProvider()`. */
    initial?: { date: string; minutes: number }
}

/** `date` shifted forward by one day, wrapping month/year boundaries via `Date`. */
function nextDate(date: string): string {
    const d = new Date(`${date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0, 10)
}

/** Key identifying the whole minute `state` falls in, for deduping `onMinuteChange` calls. */
function minuteKey(state: ClockState): string {
    return `${state.date}:${Math.floor(state.minutes)}`
}

/**
 * A plain module with its own animation-frame loop and subscriber list — deliberately not a
 * `@tanstack/store` (or any other store some panel might subscribe to wholesale). A store write
 * per frame would re-render every subscribed panel sixty times a second to move some dots; this
 * instead notifies its own listeners directly (the map updates a GeoJSON source imperatively, the
 * controls hold local component state) and mirrors into `appStore` — via `onMinuteChange` — only
 * when the whole minute actually changes, which is all the departure board or a date/time input
 * ever needs.
 */
export function createClock(options: ClockOptions = {}): Clock {
    const now = options.now ?? (() => performance.now())
    const scheduleFrame =
        options.scheduleFrame ?? ((callback: (time: number) => void) => requestAnimationFrame(callback))
    const cancelFrame = options.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle))
    const momentProvider = options.momentProvider ?? nowInPrague
    const onMinuteChange = options.onMinuteChange

    const initialMoment = options.initial ?? momentProvider()
    let state: ClockState = {
        date: initialMoment.date,
        minutes: initialMoment.minutes,
        playing: false,
        speed: CLOCK_SPEEDS[0],
    }
    // Primed silently, without calling `onMinuteChange` — `appStore`'s own initial state is
    // already this same moment (computed the same way, at nearly the same instant), so the first
    // real write should happen only once the clock's minute genuinely moves on from here.
    let lastNotifiedKey = minuteKey(state)

    let frameHandle: number | null = null
    let lastFrameTime: number | null = null
    const listeners = new Set<ClockListener>()

    function emit(): void {
        const key = minuteKey(state)
        if (key !== lastNotifiedKey) {
            lastNotifiedKey = key
            onMinuteChange?.(state.date, Math.floor(state.minutes))
        }
        for (const listener of listeners) {
            listener(state)
        }
    }

    function advance(deltaMinutes: number): void {
        let minutes = state.minutes + deltaMinutes
        let date = state.date
        while (minutes >= MINUTES_PER_DAY) {
            minutes -= MINUTES_PER_DAY
            date = nextDate(date)
        }
        state = { ...state, date, minutes }
        emit()
    }

    function tick(time: number): void {
        const last = lastFrameTime ?? time
        const elapsedSeconds = Math.max(0, (time - last) / 1000)
        lastFrameTime = time
        advance((elapsedSeconds * state.speed) / 60)
        // Re-check `playing` after advancing: nothing here can pause the clock mid-tick today,
        // but re-scheduling based on live state rather than a stale closure is the same
        // discipline that keeps this loop honestly "only runs while playing".
        if (state.playing) {
            frameHandle = scheduleFrame(tick)
        }
    }

    function stopFrameLoop(): void {
        if (frameHandle !== null) {
            cancelFrame(frameHandle)
            frameHandle = null
        }
        lastFrameTime = null
    }

    return {
        getState: () => state,

        subscribe: (listener) => {
            listeners.add(listener)
            listener(state)
            return () => {
                listeners.delete(listener)
            }
        },

        play: () => {
            if (state.playing) {
                return
            }
            state = { ...state, playing: true }
            lastFrameTime = now()
            frameHandle = scheduleFrame(tick)
            emit()
        },

        pause: () => {
            if (!state.playing) {
                return
            }
            stopFrameLoop()
            state = { ...state, playing: false }
            emit()
        },

        setSpeed: (speed) => {
            state = { ...state, speed }
            emit()
        },

        seek: (date, minutes) => {
            state = { ...state, date, minutes }
            emit()
        },

        resetToNow: () => {
            const moment = momentProvider()
            state = { ...state, date: moment.date, minutes: moment.minutes }
            emit()
        },
    }
}

/** The app-wide clock. Mirrors into `appStore` so panels that only care about whole minutes —
 * the departure board, `TimeControl`'s date/time inputs — re-render at most once per simulated
 * minute rather than once per frame. */
export const clock: Clock = createClock({ onMinuteChange: setMoment })
