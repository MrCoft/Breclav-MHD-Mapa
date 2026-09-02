// Positron is near-monochrome and built as a ground for data overlays — routes read as the
// medium-dark saturated strokes they're coloured as, rather than competing with basemap detail.
export const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron'

export const BRECLAV_CENTER: [number, number] = [16.882, 48.759]
export const INITIAL_ZOOM = 12

export const DIM_COLOR = '#b6bcc4'

/** Darker, larger circle for the stops served by the currently selected line. */
export const SELECTED_STOP_COLOR = '#14456b'

/** Sentinel for "match nothing" — no line id equals it, so a filtered layer draws empty. */
export const NO_LINE = '__none__'
