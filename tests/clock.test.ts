import { describe, expect, it, vi } from 'vitest'
import { CLOCK_SPEEDS, createClock } from '../src/state/clock'
import type { ClockState } from '../src/state/clock'

/**
 * A fully controlled clock: `now()` and the frame it schedules both come from the same fake
 * timeline, advanced only by explicit `advanceRealMs` calls — no real timers, no sleeping. This
 * is exactly why `createClock` takes `now`/`scheduleFrame`/`cancelFrame` as options rather than
 * reaching for `performance.now`/`requestAnimationFrame` unconditionally.
 */
function createTestClock(overrides: Partial<Parameters<typeof createClock>[0]> = {}) {
    let currentTime = 0
    let scheduled: ((time: number) => void) | null = null
    let nextHandle = 0
    const scheduleFrame = vi.fn((callback: (time: number) => void) => {
        scheduled = callback
        nextHandle += 1
        return nextHandle
    })
    const cancelFrame = vi.fn((_handle: number) => {
        scheduled = null
    })
    const onMinuteChange = vi.fn()

    const clock = createClock({
        now: () => currentTime,
        scheduleFrame,
        cancelFrame,
        onMinuteChange,
        initial: { date: '2026-06-15', minutes: 480 },
        ...overrides,
    })

    /** Advances the fake clock by `ms` of real time and, if a frame is pending, runs it. */
    function advanceRealMs(ms: number): void {
        currentTime += ms
        const callback = scheduled
        scheduled = null
        callback?.(currentTime)
    }

    return { clock, advanceRealMs, scheduleFrame, cancelFrame, onMinuteChange }
}

describe('createClock: advancing while playing', () => {
    it('advances minutes by elapsed real seconds / 60 at 1x', () => {
        const { clock, advanceRealMs } = createTestClock()
        clock.play()
        advanceRealMs(60_000) // 60 real seconds at 1x -> 1 simulated minute
        expect(clock.getState().minutes).toBeCloseTo(481, 9)
    })

    it('multiplies the advance by the current speed', () => {
        const { clock, advanceRealMs } = createTestClock()
        clock.setSpeed(60)
        clock.play()
        advanceRealMs(1_000) // 1 real second at 60x -> 1 simulated minute
        expect(clock.getState().minutes).toBeCloseTo(481, 9)
    })

    it('accumulates across several frames', () => {
        const { clock, advanceRealMs } = createTestClock()
        clock.setSpeed(300)
        clock.play()
        advanceRealMs(2_000) // 2s * 300/60 = 10 minutes
        advanceRealMs(2_000) // another 10 minutes
        expect(clock.getState().minutes).toBeCloseTo(500, 9)
    })
})

describe('createClock: pausing', () => {
    it('stops advancement and cancels the pending frame', () => {
        const { clock, advanceRealMs, cancelFrame } = createTestClock()
        clock.play()
        advanceRealMs(30_000)
        const minutesAtPause = clock.getState().minutes
        clock.pause()
        expect(cancelFrame).toHaveBeenCalledTimes(1)
        expect(clock.getState().playing).toBe(false)

        // No frame is pending after pause, so this is a no-op even though real time "passes".
        advanceRealMs(30_000)
        expect(clock.getState().minutes).toBe(minutesAtPause)
    })

    it('never schedules a frame before play() is called', () => {
        const { scheduleFrame } = createTestClock()
        expect(scheduleFrame).not.toHaveBeenCalled()
    })

    it('schedules exactly one frame per tick while playing, none once paused', () => {
        const { clock, advanceRealMs, scheduleFrame } = createTestClock()
        clock.play()
        expect(scheduleFrame).toHaveBeenCalledTimes(1)
        advanceRealMs(1_000)
        expect(scheduleFrame).toHaveBeenCalledTimes(2)
        clock.pause()
        advanceRealMs(1_000)
        expect(scheduleFrame).toHaveBeenCalledTimes(2)
    })

    it('play() after pause() resumes without a jump from the paused-over interval', () => {
        const { clock, advanceRealMs } = createTestClock()
        clock.play()
        advanceRealMs(60_000) // +1 minute
        clock.pause()
        advanceRealMs(120_000) // time passes while paused; must not count
        clock.play()
        advanceRealMs(60_000) // +1 more minute
        expect(clock.getState().minutes).toBeCloseTo(482, 9)
    })
})

describe('createClock: seeking', () => {
    it('sets date and minutes exactly, without wrapping or clamping', () => {
        const { clock } = createTestClock()
        clock.seek('2026-06-16', 725)
        expect(clock.getState().date).toBe('2026-06-16')
        expect(clock.getState().minutes).toBe(725)
    })

    it('does not change playing or speed', () => {
        const { clock } = createTestClock()
        clock.setSpeed(60)
        clock.play()
        clock.seek('2026-06-20', 100)
        expect(clock.getState().playing).toBe(true)
        expect(clock.getState().speed).toBe(60)
    })
})

describe('createClock: crossing midnight', () => {
    it('rolls to the next date and wraps minutes when advancing past 1440', () => {
        const { clock, advanceRealMs } = createTestClock({ initial: { date: '2026-06-15', minutes: 1439 } })
        clock.play()
        advanceRealMs(120_000) // 2 simulated minutes at 1x -> 1439 + 2 = 1441 -> day+1, minute 1
        expect(clock.getState().date).toBe('2026-06-16')
        expect(clock.getState().minutes).toBeCloseTo(1, 9)
    })

    it('wraps a December 31st into the next January', () => {
        const { clock, advanceRealMs } = createTestClock({ initial: { date: '2026-12-31', minutes: 1439 } })
        clock.play()
        advanceRealMs(60_000) // +1 minute -> exactly 1440 -> wraps to 0
        expect(clock.getState().date).toBe('2027-01-01')
        expect(clock.getState().minutes).toBeCloseTo(0, 9)
    })
})

describe('createClock: subscribing', () => {
    it('calls a new subscriber immediately with the current state', () => {
        const { clock } = createTestClock()
        const listener = vi.fn()
        clock.subscribe(listener)
        expect(listener).toHaveBeenCalledTimes(1)
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ date: '2026-06-15', minutes: 480 }))
    })

    it('notifies on seek, play, pause and speed changes', () => {
        const { clock } = createTestClock()
        const listener = vi.fn()
        clock.subscribe(listener) // 1: immediate
        clock.seek('2026-06-15', 500) // 2
        clock.play() // 3
        clock.setSpeed(60) // 4
        clock.pause() // 5
        expect(listener).toHaveBeenCalledTimes(5)
    })

    it('notifies once per frame while playing', () => {
        const { clock, advanceRealMs } = createTestClock()
        const listener = vi.fn()
        clock.subscribe(listener) // 1: immediate
        clock.play() // 2
        advanceRealMs(1_000) // 3
        advanceRealMs(1_000) // 4
        expect(listener).toHaveBeenCalledTimes(4)
    })

    it('stops notifying after unsubscribe', () => {
        const { clock } = createTestClock()
        const listener = vi.fn()
        const unsubscribe = clock.subscribe(listener)
        clock.seek('2026-06-15', 500)
        const countBeforeUnsubscribe = listener.mock.calls.length
        unsubscribe()
        clock.seek('2026-06-16', 600)
        clock.play()
        clock.pause()
        expect(listener).toHaveBeenCalledTimes(countBeforeUnsubscribe)
    })

    it('an independent second subscriber is unaffected by the first unsubscribing', () => {
        const { clock } = createTestClock()
        const first = vi.fn()
        const second = vi.fn()
        const unsubscribeFirst = clock.subscribe(first)
        clock.subscribe(second)
        unsubscribeFirst()
        clock.seek('2026-06-16', 600)
        expect(second).toHaveBeenCalledTimes(2) // immediate + the seek
    })
})

describe('createClock: mirroring into onMinuteChange only on whole-minute change', () => {
    it('does not fire for a sub-minute seek', () => {
        const { clock, onMinuteChange } = createTestClock()
        onMinuteChange.mockClear() // discard anything from clock construction, if any
        clock.seek('2026-06-15', 480.9)
        expect(onMinuteChange).not.toHaveBeenCalled()
    })

    it('fires once, with the floored minute, when the whole minute changes', () => {
        const { clock, onMinuteChange } = createTestClock()
        onMinuteChange.mockClear()
        clock.seek('2026-06-15', 481.2)
        expect(onMinuteChange).toHaveBeenCalledTimes(1)
        expect(onMinuteChange).toHaveBeenCalledWith('2026-06-15', 481)
    })

    it('fires on a date change even when the floored minute is unchanged', () => {
        const { clock, onMinuteChange } = createTestClock()
        onMinuteChange.mockClear()
        clock.seek('2026-06-16', 480)
        expect(onMinuteChange).toHaveBeenCalledTimes(1)
        expect(onMinuteChange).toHaveBeenCalledWith('2026-06-16', 480)
    })

    it('fires at most once even across many same-minute frames', () => {
        const { clock, advanceRealMs, onMinuteChange } = createTestClock({
            initial: { date: '2026-06-15', minutes: 480 },
        })
        onMinuteChange.mockClear()
        clock.play()
        // 10 frames of 100ms at 1x: 1 simulated second each, 10 total -> still within minute 480.
        for (let i = 0; i < 10; i += 1) {
            advanceRealMs(100)
        }
        expect(onMinuteChange).not.toHaveBeenCalled()
    })
})

describe('createClock: resetToNow', () => {
    it('seeks to the injected moment provider, independent of now()', () => {
        const momentProvider = () => ({ date: '2026-09-02', minutes: 700 })
        const { clock } = createTestClock({ momentProvider })
        clock.seek('2020-01-01', 0)
        clock.resetToNow()
        expect(clock.getState().date).toBe('2026-09-02')
        expect(clock.getState().minutes).toBe(700)
    })

    it('does not change playing or speed', () => {
        const momentProvider = () => ({ date: '2026-09-02', minutes: 700 })
        const { clock } = createTestClock({ momentProvider })
        clock.setSpeed(10)
        clock.play()
        clock.resetToNow()
        expect(clock.getState().playing).toBe(true)
        expect(clock.getState().speed).toBe(10)
    })
})

describe('createClock: defaults', () => {
    it('starts paused at speed 1', () => {
        const { clock } = createTestClock()
        const state: ClockState = clock.getState()
        expect(state.playing).toBe(false)
        expect(state.speed).toBe(CLOCK_SPEEDS[0])
    })

    it('falls back to performance.now and requestAnimationFrame when not overridden', () => {
        // Just checks construction doesn't throw when relying on the real defaults — this test
        // environment (jsdom-less "node") still exposes both globals via vitest's setup.
        expect(() => createClock({ initial: { date: '2026-06-15', minutes: 0 } })).not.toThrow()
    })
})
