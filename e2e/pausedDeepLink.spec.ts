import { expect, test } from '@playwright/test'

// A moment known (from docs/known-bugs.md entry 4) to have running vehicles in both scenarios:
// `?d=2026-09-02&t=07:30` produced 31-40 vehicles while playing and, before this bug was fixed,
// 0 while paused — reproducing identically for `?s=proposed&d=2026-09-02&t=07:30` too, which is
// why this suite doesn't bother re-testing every scenario/time combination.
const DATE = '2026-09-02'
const TIME = '07:30'

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

test('the playing case (no explicit time) still populates the vehicles source', async ({ page }) => {
    await page.goto('/')

    const mapContainer = page.locator('[data-vehicles-rendered]')
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
