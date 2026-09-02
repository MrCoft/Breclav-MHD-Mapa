import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import viteTsconfigPaths from 'vite-tsconfig-paths'

// Tests run on their own config, kept apart from the app's vite.config.ts, so the app's
// Tailwind/build plugins don't leak into test runs and component tests still get a React renderer.
// Default environment stays node — existing tests are plain TS with no DOM. A component test
// opts into the DOM by adding `// @vitest-environment jsdom` at the top of its file.
export default defineConfig({
    plugins: [viteTsconfigPaths({ projects: ['./tsconfig.json'] }), react()],
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    },
})
