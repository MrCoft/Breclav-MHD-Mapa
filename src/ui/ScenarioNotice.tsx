import { useStore } from '@tanstack/react-store'
import { servicesOnDate } from '../domain/calendar'
import { appStore } from '../state/store'
import type { NetworkIndex } from '../data/buildIndex'

/**
 * True if some pattern *not* on `inheritedLineIds` has a trip running on `date`. For a scenario
 * with no inherited lines this is effectively "does the network run at all that day"; for the
 * proposed scenario, whose only non-inherited service is the synthesised school-term weekday one
 * (`docs/decisions.md` #19, `build-proposal.ts`'s `SERVICE_ID`), it is false on every weekend and
 * school holiday — precisely the gap this component exists to explain.
 */
export function hasOwnService(index: NetworkIndex, date: string, inheritedLineIds: ReadonlySet<string>): boolean {
    const activeServices = servicesOnDate(index.services, date)
    if (activeServices.size === 0) {
        return false
    }
    for (const pattern of index.network.patterns) {
        if (inheritedLineIds.has(pattern.line)) {
            continue
        }
        const trips = index.tripsByPattern.get(pattern.id)
        if (trips?.some((trip) => activeServices.has(trip.service))) {
            return true
        }
    }
    return false
}

/**
 * Warns when the showing scenario's own lines have no service on the selected date. Today this
 * only ever fires for the proposed network: its petition source covers school-term weekdays only
 * (`data/navrh_2026_new2.xlsx`'s header, "Všední den neprázdninový"), so `build-proposal.ts`
 * synthesises one Monday–Friday service and carries lines 571/574 over from the current scenario
 * unchanged (`meta.inheritedLines`). Without this notice, a visitor who opens the site on a
 * weekend and switches to "Návrh 2026" sees the proposal's route lines with zero vehicles and
 * every stop panel reading "V tuto dobu odsud nic nejede." — which reads as "the proposal
 * abolishes the city network" rather than "this data only covers weekdays."
 *
 * Deliberately does not move the date: see the task brief's finding C2 — a map that silently
 * changes what you asked for is worse than one that explains itself. The date stays exactly
 * where the visitor (or a deep link) put it; this only adds an explanation over it.
 */
export const ScenarioNotice = () => {
    const scenario = useStore(appStore, (state) => state.scenario)
    const date = useStore(appStore, (state) => state.date)

    if (scenario === null) {
        return null
    }
    const inherited = scenario.meta.inheritedLines
    if (inherited === undefined) {
        return null
    }
    if (hasOwnService(scenario.index, date, new Set(inherited.lines))) {
        return null
    }

    return (
        <p role="status" className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            Návrh obsahuje jízdní řády pouze pro všední dny ve školním roce.
        </p>
    )
}
