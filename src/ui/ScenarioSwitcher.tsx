import { useEffect, useState } from 'react'
import { useStore } from '@tanstack/react-store'
import { listScenarios } from '../data/loadScenario'
import { appStore, setScenarioId } from '../state/store'
import type { ScenarioRef } from '../types/network'

/**
 * Governs everything below it, so it sits above `LineBrowser` in both the desktop sidebar and
 * the mobile drawer (see `App`) — never in the already-crowded top bar. Renders whichever
 * scenarios `scenarios.json` lists rather than assuming there are exactly two.
 *
 * Fetches the list itself, independently of the scenario data `App` loads: it's supplementary
 * navigation, not something the map or the line browser need to render. Clicking an option only
 * changes `appStore`'s `scenarioId` — the fetch, validation and swap of the actual map data
 * happen in `App` and `MapView` once that id changes, and the previous scenario stays on screen
 * until that finishes, so this component doesn't need to track loading state itself.
 */
export const ScenarioSwitcher = () => {
    const scenarioId = useStore(appStore, (state) => state.scenarioId)
    const [scenarios, setScenarios] = useState<ScenarioRef[]>([])

    useEffect(() => {
        let cancelled = false
        listScenarios()
            .then((loaded) => {
                if (!cancelled) {
                    setScenarios(loaded)
                }
            })
            .catch(() => {
                // Supplementary UI: if the list itself can't be fetched, the switcher just stays
                // hidden rather than raising a second error banner alongside App's own.
            })
        return () => {
            cancelled = true
        }
    }, [])

    if (scenarios.length === 0) {
        return null
    }

    return (
        <div className="mb-3">
            <h2 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Scénář sítě</h2>
            <div className="flex gap-1 rounded-md border border-slate-200 bg-slate-50 p-1">
                {scenarios.map((scenario) => {
                    const isSelected = scenario.id === scenarioId
                    return (
                        <button
                            key={scenario.id}
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => setScenarioId(scenario.id)}
                            className={`min-h-11 flex-1 rounded px-2 text-sm ${
                                isSelected
                                    ? 'bg-white font-semibold text-accent-foreground shadow-sm'
                                    : 'text-slate-600 hover:bg-slate-100'
                            }`}
                        >
                            {scenario.label}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
