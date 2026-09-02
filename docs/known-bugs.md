# Known bugs

Append-only. Never remove an entry — the user decides when a bug is closed.

Each entry: a short title, the date found and what was being done, `path/to/file:line`, the problem, and the impact.

## 1. A failed basemap fetch leaves the map blank instead of degrading

**Found:** 2026-09-02, while scanning the implementation plan against the design spec.
**Where:** `src/map/MapView.tsx` (the layer-installation effect, which runs on `m.once('load', install)`).
**Problem:** The spec promises that if OpenFreeMap is unreachable, routes and stops still render over an empty background. They will not. Layer installation waits on MapLibre's `load` event, and a style fetch that fails never fires it, so no source and no layer is ever added.
**Impact:** A third-party outage turns the whole map blank rather than degrading to an unstyled but usable network diagram. Rare, and it does not affect correctness of the data — but the spec claims behaviour the code does not have. The fix is a local fallback style object installed on the map's `error` event; it is self-contained to `MapView`.
