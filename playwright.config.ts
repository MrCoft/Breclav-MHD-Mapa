import { defineConfig, devices } from '@playwright/test'

// Runs against `vite preview` of a real production build, not the dev server — this project has
// already shipped a bug (MapLibre's worker path) that was fine in dev and blank in production,
// with no console error and a green unit-test suite. `webServer` below builds first, so the test
// always exercises the actual bundle, and `baseURL` includes the Pages base path: testing the
// domain root would still pass against a deploy that is broken for real users at its real path.
export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    reporter: 'list',
    use: {
        baseURL: 'http://localhost:4173/Breclav-MHD-Mapa/',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: 'pnpm run build && pnpm run preview --port 4173',
        url: 'http://localhost:4173/Breclav-MHD-Mapa/',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
})
