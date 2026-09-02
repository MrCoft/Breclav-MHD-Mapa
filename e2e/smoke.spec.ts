import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { Network } from '../src/types/network'

// Real stop and line ids from the committed scenario, not guessed slugs — a hand-authored id
// here would silently rot the moment the network is regenerated.
const networkPath = fileURLToPath(new URL('../public/data/current/network.json', import.meta.url))
const network = JSON.parse(readFileSync(networkPath, 'utf-8')) as Network

const LINE_ID = '563'
const line = network.lines.find((candidate) => candidate.id === LINE_ID)
if (!line) {
    throw new Error(`Fixture line "${LINE_ID}" is not in network.json — pick a line that still exists.`)
}

const pattern = network.patterns.find((candidate) => candidate.line === LINE_ID)
const stopId = pattern?.stops[0]
if (!stopId) {
    throw new Error(`Line "${LINE_ID}" has no pattern with a first stop to deep-link to.`)
}
const stop = network.stops.find((candidate) => candidate.id === stopId)
if (!stop) {
    throw new Error(`Stop "${stopId}" (from line "${LINE_ID}"'s first pattern) is not in network.json.`)
}

test('production build renders, a line selects, and a deep link restores a stop', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (message) => {
        if (message.type() === 'error') {
            consoleErrors.push(message.text())
        }
    })
    page.on('pageerror', (error) => {
        consoleErrors.push(error.message)
    })

    // 1. The sidebar lists lines only once the scenario has fetched, validated and indexed.
    await page.goto('/')
    const lineButton = page.getByRole('button', { name: line.longName })
    await expect(lineButton).toBeVisible()

    // 1b. The map itself actually rendered something, not just the chrome around it. MapLibre
    // parses GeoJSON sources in a web worker, so if the worker script fails to load — exactly
    // the production-only regression this suite exists to catch — the `routes` source never
    // produces features while the sidebar, footer and stop panel are entirely unaffected (they
    // render from React state, not from the map). MapView writes the live
    // `querySourceFeatures('routes').length` count to `data-routes-rendered` on the map
    // container every time the map goes idle, so this asserts the worker did real work without
    // touching the canvas itself.
    const mapContainer = page.locator('[data-routes-rendered]')
    await expect(mapContainer).toHaveAttribute('data-routes-rendered', /^[1-9]\d*$/)

    // 2. Selecting a line is reflected in aria-pressed.
    await lineButton.click()
    await expect(lineButton).toHaveAttribute('aria-pressed', 'true')

    // 3. Deep-link to a stop with an explicit date and time via the query string — exercising the
    // URL state Part 1 built, rather than hunting for a rendered circle inside the WebGL canvas.
    await page.goto(`/?line=${line.id}&stop=${stop.id}&d=2026-09-02&t=07:30`)

    // 4. The stop panel appears and shows either departures or the explicit empty-state message,
    // never a blank panel.
    await expect(page.getByRole('heading', { name: stop.name })).toBeVisible()
    await expect(page.locator('table').or(page.getByText('V tuto dobu odsud nic nejede.'))).toBeVisible()

    // 5. No console errors — the favicon 404 is fixed, so a clean run is the expectation.
    expect(consoleErrors).toEqual([])
})
