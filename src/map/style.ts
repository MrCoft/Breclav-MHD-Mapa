// The style the map boots into, and also what the switcher's "Mapa" entry points at (see
// `BASEMAPS` in basemaps.ts) — one constant, so the default and that entry can never drift apart.
// Currently OpenFreeMap's Bright. Positron (near-monochrome) was the original default, chosen as
// a ground for data overlays so routes would read as the medium-dark saturated strokes they're
// coloured as rather than competing with basemap detail — `mapColor`/`casingColor` in color.ts
// were tuned and numerically validated against it, and Bright's extra saturation may read as
// mildly less legible than that tuning intended. That's a basemap choice, not a colour bug: to
// go back, change only this one URL to `https://tiles.openfreemap.org/styles/positron` — do not
// re-tune the colour normalisation to compensate.
export const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/bright'

export const BRECLAV_CENTER: [number, number] = [16.882, 48.759]
export const INITIAL_ZOOM = 12

export const DIM_COLOR = '#b6bcc4'

/** Darker, larger circle for the stops served by the currently selected line. */
export const SELECTED_STOP_COLOR = '#14456b'

/** Sentinel for "match nothing" — no line id equals it, so a filtered layer draws empty. */
export const NO_LINE = '__none__'
