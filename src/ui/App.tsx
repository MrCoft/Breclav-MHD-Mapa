import { Menu } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useStore } from '@tanstack/react-store'
import { MapView } from '../map/MapView'
import { loadScenario } from '../data/loadScenario'
import { clock } from '../state/clock'
import { appStore, selectLine, selectStop, setError, setScenario, setScenarioId } from '../state/store'
import { readUrlState } from '../state/urlState'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '../components/shadcn/sheet'
import { ClockControls } from './ClockControls'
import { Footer } from './Footer'
import { LineBrowser } from './LineBrowser'
import { ScenarioSwitcher } from './ScenarioSwitcher'
import { StopPanel } from './StopPanel'

export const App = () => {
    const scenarioId = useStore(appStore, (state) => state.scenarioId)
    const scenario = useStore(appStore, (state) => state.scenario)
    const error = useStore(appStore, (state) => state.error)
    const selectedLine = useStore(appStore, (state) => state.selectedLine)
    const selectedStop = useStore(appStore, (state) => state.selectedStop)
    const [drawerOpen, setDrawerOpen] = useState(false)

    // Read the URL once, on mount, and apply whatever it contains before the scenario load below
    // fires. Scenario, line and stop are ordinary view selections, restored unconditionally. Date
    // and time are different: they name one specific moment, reachable only by explicitly
    // building a link (`ClockControls`'s "Odkaz na čas" button) — never written just because the
    // clock happens to be somewhere. So their presence here means "this is a link to a moment":
    // seek there and stay paused, showing exactly what was shared. Their absence means "this is a
    // live view": start the clock playing, at 1x, from wherever `nowInPrague` already put it.
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
        } else {
            clock.play()
        }
    }, [])

    // Mirrors scenario/line/stop into the URL on every change, with `replaceState` — never
    // `pushState`, which would fill the back button with an entry per selection. Patches only
    // these three params onto whatever query string already exists, rather than rebuilding it
    // from scratch: date and time are never written here, no matter how the clock moves, so any
    // `d`/`t` a deep link arrived with (or the copy button just wrote) is left exactly as is.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        params.set('s', scenarioId)
        if (selectedLine !== null) {
            params.set('line', selectedLine)
        } else {
            params.delete('line')
        }
        if (selectedStop !== null) {
            params.set('stop', selectedStop)
        } else {
            params.delete('stop')
        }
        window.history.replaceState(null, '', `?${params.toString()}`)
    }, [scenarioId, selectedLine, selectedStop])

    // The line drawer (below `md`; see the top bar rendered further down) closes the instant a
    // line selection lands, so the user sees the highlight they just asked for rather than the
    // drawer still covering the map.
    useEffect(() => {
        setDrawerOpen(false)
    }, [selectedLine])

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
        <div className="grid h-dvh grid-rows-[auto_1fr_auto]">
            {/* Below `md`, the sidebar (further down) is hidden and its line browser instead
                lives in this drawer, opened from a compact top bar. At `md` and up this whole row
                collapses to nothing (`md:hidden`), leaving the desktop layout exactly as before. */}
            <div className="flex items-center gap-2 border-b border-slate-200 p-2 md:hidden">
                <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
                    <SheetTrigger asChild>
                        <button
                            type="button"
                            aria-label="Otevřít seznam linek"
                            className="flex size-11 shrink-0 items-center justify-center rounded-md border border-slate-300 hover:bg-slate-100"
                        >
                            <Menu className="size-5" />
                        </button>
                    </SheetTrigger>
                    <SheetContent side="left" className="w-[85%] max-w-[320px] p-0">
                        <SheetTitle className="sr-only">Linky</SheetTitle>
                        <SheetDescription className="sr-only">Seznam autobusových a vlakových linek</SheetDescription>
                        <div className="h-full overflow-y-auto p-3">
                            <ScenarioSwitcher />
                            <LineBrowser />
                        </div>
                    </SheetContent>
                </Sheet>
                <span className="text-sm font-semibold">MHD Břeclav</span>
            </div>
            <div className="grid grid-cols-1 overflow-hidden md:grid-cols-[280px_1fr]">
                <aside className="hidden overflow-y-auto border-r border-slate-200 p-3 md:block">
                    <ScenarioSwitcher />
                    <LineBrowser />
                </aside>
                <div className="relative">
                    <MapView />
                    {/* Below `md`: ClockControls and StopPanel stack in normal flow inside this
                        bottom-anchored wrapper, so the stop panel's bottom sheet never covers the
                        clock controls above it. `max-h-full` caps the wrapper at the map area's
                        own height — on a short phone screen, ClockControls (`shrink-0` — it must
                        never give up space) plus StopPanel's 60dvh cap can add up to more than
                        that, and without this the excess would push ClockControls' own top edge
                        up past `.relative`'s bounds, clipped invisibly by the grid row's
                        `overflow-hidden` below. With it, flexbox instead shrinks StopPanel (it
                        already scrolls its own content — see its `min-h-0`) to whatever room is
                        actually left. At `md` and up the wrapper becomes `display: contents` — it
                        stops generating a box at all, so each child's own `md:absolute`
                        positioning (unchanged from before this task) takes over and they float
                        independently over the map exactly as they did previously. */}
                    <div className="absolute inset-x-0 bottom-0 flex max-h-full flex-col md:contents">
                        <ClockControls />
                        <StopPanel />
                    </div>
                </div>
            </div>
            <Footer feedDate={scenario.meta.feedDate} />
        </div>
    )
}
