import { useEffect } from 'react'
import { useStore } from '@tanstack/react-store'
import { MapView } from '../map/MapView'
import { loadScenario } from '../data/loadScenario'
import { clock } from '../state/clock'
import { appStore, selectLine, selectStop, setError, setScenario, setScenarioId } from '../state/store'
import { readUrlState, writeUrlState } from '../state/urlState'
import { ClockControls } from './ClockControls'
import { Footer } from './Footer'
import { LineBrowser } from './LineBrowser'
import { StopPanel } from './StopPanel'

export const App = () => {
    const scenarioId = useStore(appStore, (state) => state.scenarioId)
    const scenario = useStore(appStore, (state) => state.scenario)
    const error = useStore(appStore, (state) => state.error)
    const selectedLine = useStore(appStore, (state) => state.selectedLine)
    const selectedStop = useStore(appStore, (state) => state.selectedStop)
    const date = useStore(appStore, (state) => state.date)
    const minutes = useStore(appStore, (state) => state.minutes)

    // Read the URL once, on mount, and apply whatever it contains before the scenario load below
    // fires. Date and time are restored independently — the store already defaults the date to
    // today, so a bare `?t=07:30` is a valid, unambiguous link even with no `?d=`. Routed through
    // `clock.seek`, not `setMoment` directly — the clock is the app's single source of truth for
    // time, and writing `appStore` here without it would leave the clock (and so the map's
    // vehicles) sitting at "now" while every whole-minute panel showed the deep-linked moment.
    useEffect(() => {
        const urlState = readUrlState(window.location.search)
        if (urlState.scenarioId !== undefined) {
            setScenarioId(urlState.scenarioId)
        }
        if (urlState.selectedLine !== undefined) {
            selectLine(urlState.selectedLine)
        }
        if (urlState.selectedStop !== undefined) {
            selectStop(urlState.selectedStop)
        }
        if (urlState.date !== undefined || urlState.minutes !== undefined) {
            const current = clock.getState()
            clock.seek(urlState.date ?? current.date, urlState.minutes ?? current.minutes)
        }
    }, [])

    // Mirror the store back into the URL on every change, with `replaceState` — never
    // `pushState`, which would fill the back button with an entry per time-input keystroke.
    useEffect(() => {
        const search = writeUrlState({ scenarioId, selectedLine, selectedStop, date, minutes })
        window.history.replaceState(null, '', search)
    }, [scenarioId, selectedLine, selectedStop, date, minutes])

    useEffect(() => {
        let cancelled = false
        loadScenario(scenarioId)
            .then((loaded) => {
                if (!cancelled) {
                    setScenario(loaded)
                }
            })
            .catch((cause: unknown) => {
                if (!cancelled) {
                    setError(cause instanceof Error ? cause.message : String(cause))
                }
            })
        return () => {
            cancelled = true
        }
    }, [scenarioId])

    if (error !== null) {
        return (
            <div className="m-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                Data se nepodařilo načíst: {error}
            </div>
        )
    }

    if (scenario === null) {
        return <div className="m-3 p-3 text-sm text-slate-600">Načítám síť…</div>
    }

    return (
        // `dvh`, not `vh`: on mobile, `100vh` is taller than the visible viewport (it ignores the
        // browser chrome's address bar), which would push ClockControls — anchored to the bottom
        // of the map area below — off-screen.
        <div className="grid h-dvh grid-rows-[1fr_auto]">
            <div className="grid grid-cols-[280px_1fr] overflow-hidden">
                <aside className="overflow-y-auto border-r border-slate-200 p-3">
                    <LineBrowser />
                </aside>
                <div className="relative">
                    <MapView />
                    <StopPanel />
                    <ClockControls />
                </div>
            </div>
            <Footer feedDate={scenario.meta.feedDate} />
        </div>
    )
}
