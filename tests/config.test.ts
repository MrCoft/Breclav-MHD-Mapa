import { describe, expect, it } from 'vitest'
import config from '../vite.config'

describe('vite config', () => {
    it('uses the GitHub Pages project subpath as base', () => {
        expect(config.base).toBe('/Breclav-MHD-Mapa/')
    })
})
