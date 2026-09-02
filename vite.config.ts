import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import viteTsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
    base: '/Breclav-MHD-Mapa/',
    plugins: [viteTsconfigPaths({ projects: ['./tsconfig.json'] }), tailwindcss(), react()],
})
