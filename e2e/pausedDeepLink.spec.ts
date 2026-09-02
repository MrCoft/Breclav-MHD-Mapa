import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { buildIndex } from '../src/data/buildIndex'
import { servicesOnDate, weekdayIndex } from '../src/domain/calendar'
import { formatMinutes } from '../src/domain/formatMinutes'
import { buildPatternGeometry } from '../src/domain/patternGeometry'
import { vehiclesAt } from '../src/domain/vehicles'
import type { FeatureCollection, LineString } from 'geojson'
import type { PatternGeometryProperties } from '../src/domain/patternGeometry'
import type { Network } from '../src/types/network'

// This suite used to hard-code `DATE = '2026-09-02'` and, for the "playing" case, load `/` with
// no `?d=`/`?t=` at all — trusting whatever the wall clock in Prague happened to read. Both rot:
// every service in the committed feed ends 2026-12-11/12, so the hard-coded date stops being
// valid the instant that window passes, and zero vehicles run between roughly 01:30 and 04:30 on
// every date, so a CI run landing in that window failed regardless of the date. See the task
// brief (finding C1) for the measurements. Fixed the way `smoke.spec.ts` and
// `scenarioSwitch.spec.ts` already handle line/stop ids and labels: derive the moment from the
// committed data instead of guessing it.
function readJson<T>(relativePath: string): T {
    const path = fileURLToPath(new URL(relativePath, import.meta.url))
    return JSON.parse(readFileSync(path, 'utf-8')) as T
}

function loadScenario(id: string) {
    const network = readJson<Network>(`../public/data/${id}/network.json`)
    const geometry = readJson<FeatureCollection<LineString, PatternGeometryProperties>>(
        `../public/data/${id}/geometry.geojson`,
    )
    return {
        network,
        index: buildIndex(network),
        geometries: new Map(geometry.features.map((f) => [f.properties.patternId, buildPatternGeometry(f)])),
    }
}

const current = loadScenario('current')
const proposed = loadScenario('proposed')

const SEARCH_MINUTE_STEP = 15
const SEARCH_MAX_DAYS = 180
// A thin margin (a single vehicle, say) is exactly what the ~01:30-04:30 nightly gap this suite
// used to fall into can produce right at its edges — technically non-zero, but one pattern's worth
// of geometry or timetable drift away from flipping back to zero. Requiring a healthier minimum
// pushes the search toward genuine daytime service instead, without hard-coding a time-of-day
// window that would itself need to track the timetable.
const MIN_VEHICLES = 5

function addDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
}

/**
 * A moment — date plus minute — that lands inside a weekday service's `from`..`to` window and
 * has at least one running vehicle in *both* scenarios, found by actually running the app's own
 * `vehiclesAt` over the committed data rather than guessed or pinned to a fixed date (which is
 * what rotted before — see the file header). Both scenarios are required to have vehicles at the
 * chosen moment so every test below reproduces identically whichever scenario happens to be
 * showing, and the search is restricted to weekdays because the proposed scenario's synthesised
 * service only ever covers school-term weekdays (`docs/decisions.md` #19, `build-proposal.ts`) —
 * see the task brief's finding C2. Scans forward a day at a time from the earliest date either
 * scenario's services could possibly start, quarter-hour by quarter-hour within each candidate
 * day.
 */
function findSharedRunningMoment(): { date: string; minutes: number } {
    const earliestFrom = [...current.network.services, ...proposed.network.services].map((s) => s.from).sort()[0]
    if (!earliestFrom) {
        throw new Error('findSharedRunningMoment: neither scenario has any service to search from.')
    }

    for (let dayOffset = 0; dayOffset < SEARCH_MAX_DAYS; dayOffset += 1) {
        const date = addDays(earliestFrom, dayOffset)
        if (weekdayIndex(date) >= 5) {
            continue // weekends are exactly where the proposed scenario legitimately has no service
        }
        if (servicesOnDate(current.network.services, date).size === 0) {
            continue
        }
        if (servicesOnDate(proposed.network.services, date).size === 0) {
            continue
        }
        for (let minutes = 0; minutes < 1440; minutes += SEARCH_MINUTE_STEP) {
            if (vehiclesAt(current.index, current.geometries, date, minutes).length < MIN_VEHICLES) {
                continue
            }
            if (vehiclesAt(proposed.index, proposed.geometries, date, minutes).length < MIN_VEHICLES) {
                continue
            }
            return { date, minutes }
        }
    }

    throw new Error(
        `findSharedRunningMoment: found no weekday within ${SEARCH_MAX_DAYS} days of ${earliestFrom} where both ` +
            `"current" and "proposed" have at least ${MIN_VEHICLES} running vehicles at the same quarter-hour ` +
            'mark. Regenerate the network data, or widen this search, before trusting this suite again.',
    )
}

const { date: DATE, minutes: MOMENT_MINUTES } = findSharedRunningMoment()
const TIME = formatMinutes(MOMENT_MINUTES)

test('a paused deep link (?d=&t=) still populates the vehicles source', async ({ page }) => {
    // Presence of `d`/`t` means "restore this exact moment and stay there" (see `App.tsx`) — the
    // clock never plays, so there is exactly one `setData` call for `vehicles` ever going to
    // happen; no animation frame will come along to retry it if that call is lost to the race
    // between the clock's inaugural subscription call and the map style's asynchronous load
    // (known-bugs.md entry 4). `data-vehicles-rendered` mirrors
    // `querySourceFeatures('vehicles').length` (see `MapView.tsx`'s `updateVehiclesRendered`), the
    // same way `data-routes-rendered` already proves the routes source rendered — see
    // `e2e/smoke.spec.ts`.
    await page.goto(`/?d=${DATE}&t=${TIME}`)

    const mapContainer = page.locator('[data-vehicles-rendered]')
    await expect(mapContainer).toHaveAttribute('data-vehicles-rendered', /^[1-9]\d*$/)
})

test('resuming play from a deep-linked moment still populates the vehicles source', async ({ page }) => {
    // Exercises the playing code path without depending on wall-clock time (which is what this
    // test did before — see the file header): deep-link to the known-good moment above, paused,
    // then explicitly resume play from there via the same control a visitor would use.
    await page.goto(`/?d=${DATE}&t=${TIME}`)

    const mapContainer = page.locator('[data-vehicles-rendered]')
    await expect(mapContainer).toHaveAttribute('data-vehicles-rendered', /^[1-9]\d*$/)

    await page.getByRole('button', { name: 'Přehrát', exact: true }).click()
    await expect(mapContainer).toHaveAttribute('data-vehicles-rendered', /^[1-9]\d*$/)
})

test('switching scenarios while paused on a deep link also populates vehicles', async ({ page }) => {
    await page.goto(`/?d=${DATE}&t=${TIME}`)

    const mapContainer = page.locator('[data-vehicles-rendered]')
    await expect(mapContainer).toHaveAttribute('data-vehicles-rendered', /^[1-9]\d*$/)

    // `d`/`t` are never rewritten by the URL-mirroring effect (see `App.tsx`), so the clock stays
    // paused, at the same moment, straight through the switch.
    await page.getByRole('button', { name: 'Návrh 2026', exact: true }).click()
    await expect(page).toHaveURL(/[?&]s=proposed(?:&|$)/)
    await expect(mapContainer).toHaveAttribute('data-vehicles-rendered', /^[1-9]\d*$/)
})
