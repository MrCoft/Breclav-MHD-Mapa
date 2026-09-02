# Known bugs

Append-only. Never remove an entry — the user decides when a bug is closed.

Each entry: a short title, the date found and what was being done, `path/to/file:line`, the problem, and the impact.

## 1. A failed basemap fetch leaves the map blank instead of degrading

**Found:** 2026-09-02, while scanning the implementation plan against the design spec.
**Where:** `src/map/MapView.tsx` (the layer-installation effect, which runs on `m.once('load', install)`).
**Problem:** The spec promises that if OpenFreeMap is unreachable, routes and stops still render over an empty background. They will not. Layer installation waits on MapLibre's `load` event, and a style fetch that fails never fires it, so no source and no layer is ever added.
**Impact:** A third-party outage turns the whole map blank rather than degrading to an unstyled but usable network diagram. Rare, and it does not affect correctness of the data — but the spec claims behaviour the code does not have. The fix is a local fallback style object installed on the map's `error` event; it is self-contained to `MapView`.

## 2. Storybook 9 declares peer ranges this project's Vite and esbuild fall outside

**Found:** 2026-09-02, in the review of the stack-adoption task.
**Where:** `package.json` — `vite@8.2.2` and the transitive `esbuild@0.25.12`, against Storybook 9's declared peers.
**Problem:** `pnpm` reports unmet peer dependencies. Storybook 9 and
`@joshwooding/vite-plugin-react-docgen-typescript` declare `vite: ^5 || ^6 || ^7` and
`esbuild: ^0.27 || ^0.28`; this project has Vite 8 and esbuild 0.25.12. The Vite 8 pin predates
Storybook and was not chosen against it — installing Storybook is what surfaced the collision.
**Impact:** None observed today. `pnpm run build` and `pnpm run build-storybook` both succeed,
and the dev server and test suite are unaffected. The risk is latent: a Storybook or Vite
upgrade could turn an unmet peer into a real break, and the warning noise makes a genuine peer
problem easier to miss later. Worth revisiting when either package is next upgraded, rather
than pinning Vite backwards now to satisfy a warning nothing is currently failing on.
