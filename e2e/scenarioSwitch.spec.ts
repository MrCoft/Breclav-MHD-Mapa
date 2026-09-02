import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { Network, ScenarioRef } from '../src/types/network'

// Real ids, labels and network content from the committed scenarios, not guessed — see
// e2e/smoke.spec.ts for the same discipline.
function readNetwork(id: string): Network {
    const path = fileURLToPath(new URL(`../public/data/${id}/network.json`, import.meta.url))
    return JSON.parse(readFileSync(path, 'utf-8')) as Network
}

const current = readNetwork('current')
const proposed = readNetwork('proposed')

const scenariosPath = fileURLToPath(new URL('../public/data/scenarios.json', import.meta.url))
const scenarios = JSON.parse(readFileSync(scenariosPath, 'utf-8')) as ScenarioRef[]
const currentLabel = scenarios.find((scenario) => scenario.id === 'current')?.label
const proposedLabel = scenarios.find((scenario) => scenario.id === 'proposed')?.label
if (!currentLabel || !proposedLabel) {
    throw new Error('scenarios.json must list both "current" and "proposed" for this fixture to work.')
}

// A line the "current" scenario has and "proposed" dropped (564, in the committed data) — proves
// the switch actually swaps the network rather than being a fixture that happens to overlap.
const droppedLine = current.lines.find((line) => !proposed.lines.some((candidate) => candidate.id === line.id))
if (!droppedLine) {
    throw new Error('Fixture needs a line present in "current" but absent from "proposed".')
}

test('switching scenarios swaps the map, clears a stale selection, and follows the URL', async ({ page }) => {
    await page.goto('/')

    const switchToProposed = page.getByRole('button', { name: proposedLabel, exact: true })
    const switchToCurrent = page.getByRole('button', { name: currentLabel, exact: true })
    await expect(switchToCurrent).toHaveAttribute('aria-pressed', 'true')

    // Select a line that only "current" has.
    const droppedLineButton = page.getByRole('button', { name: droppedLine.longName })
    await expect(droppedLineButton).toBeVisible()
    await droppedLineButton.click()
    await expect(droppedLineButton).toHaveAttribute('aria-pressed', 'true')

    // Baseline: the map has rendered the current network's routes (see e2e/smoke.spec.ts for why
    // this attribute, not the canvas, is the liveness signal).
    const mapContainer = page.locator('[data-routes-rendered]')
    await expect(mapContainer).toHaveAttribute('data-routes-rendered', /^[1-9]\d*$/)
    const currentRouteCount = Number(await mapContainer.getAttribute('data-routes-rendered'))

    // Switch to "Návrh 2026". The URL follows, the sidebar's line/stop count changes to the
    // proposed network's own count, the stale line selection is gone rather than dangling, and
    // the map's `routes` source re-renders with materially fewer features — proof the map itself
    // swapped rather than installLayers silently no-opping and leaving the old network drawn.
    await switchToProposed.click()
    await expect(page).toHaveURL(/[?&]s=proposed(?:&|$)/)
    await expect(switchToProposed).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(`${proposed.lines.length} linek, ${proposed.stops.length} zastávek`)).toBeVisible()
    await expect(page.getByRole('button', { name: droppedLine.longName })).toHaveCount(0)
    await expect
        .poll(async () => Number(await mapContainer.getAttribute('data-routes-rendered')), {
            message: 'the routes source should re-render with the smaller proposed network',
        })
        .toBeLessThan(currentRouteCount)

    // Switch back: the full network returns, including the line only "current" has.
    await switchToCurrent.click()
    await expect(page).toHaveURL(/[?&]s=current(?:&|$)/)
    await expect(page.getByText(`${current.lines.length} linek, ${current.stops.length} zastávek`)).toBeVisible()
    await expect(page.getByRole('button', { name: droppedLine.longName })).toBeVisible()

    // Reloading with `?s=proposed` opens straight into the proposal.
    await page.goto('/?s=proposed')
    await expect(switchToProposed).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText(`${proposed.lines.length} linek, ${proposed.stops.length} zastávek`)).toBeVisible()
})
