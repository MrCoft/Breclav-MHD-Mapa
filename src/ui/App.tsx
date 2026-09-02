import { useEffect } from 'react'
import { useStore } from '@tanstack/react-store'
import { MapView } from '../map/MapView'
import { loadScenario } from '../data/loadScenario'
import { appStore, setError, setScenario } from '../state/store'
import { LineBrowser } from './LineBrowser'
import { StopPanel } from './StopPanel'

export const App = () => {
    const scenarioId = useStore(appStore, (state) => state.scenarioId)
    const scenario = useStore(appStore, (state) => state.scenario)
    const error = useStore(appStore, (state) => state.error)

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
        <div className="grid h-screen grid-cols-[280px_1fr]">
            <aside className="overflow-y-auto border-r border-slate-200 p-3">
                <LineBrowser />
            </aside>
            <div className="relative">
                <MapView />
                <StopPanel />
            </div>
        </div>
    )
}
