# Břeclav MHD Mapa

An interactive map of Břeclav's public transport, deployed to GitHub Pages, built to compare
today's bus network ("Současný stav") against a redesign proposed in a citizens' petition ("Návrh
2026"). Toggle between the two scenarios, animated vehicles simulated from the timetable,
departure boards, and a mobile layout.

Design reasoning and the full history of decisions live in `docs/decisions.md` — read that before
changing anything non-trivial. `docs/known-bugs.md` and `docs/open-questions.md` track defects and
unresolved calls; `docs/proposal-import.md` covers how the petition's spreadsheet becomes map
data.

## Requirements

- **Use `pnpm`, not `npm`.** `package.json` pins an exact version via `packageManager`
  (`pnpm@11.1.2+…`); `npm install` ignores that pin entirely and will fight it — install pnpm
  (via [Corepack](https://pnpm.io/installation#using-corepack) or a standalone install) and use it
  for every command below.
- Node ≥ 22.12 (`engines` in `package.json`). CI runs Node 22 specifically (decision 16); a newer
  local Node is fine for everything except matching CI's exact behaviour bit-for-bit.

## Getting started

```sh
pnpm install
pnpm dev          # Vite dev server
```

## The full check

Before calling anything done, run all of:

```sh
pnpm run build            # tsc -b && vite build
pnpm lint                 # eslint .
pnpm test                 # vitest run
pnpm run build-storybook  # storybook build
pnpm run test:e2e         # playwright test (builds and serves the app itself)
```

`pnpm run test:e2e` runs before the Pages upload in CI (`.github/workflows/deploy.yml`) — an e2e
failure blocks deployment, not just marks a build red.

## Regenerating the data

Generated network data lives in `public/data/<scenario>/` (served by the site) and is committed to
the repo, not built in CI (decision 9, decision 10). Two converters, and **order matters**:

```sh
pnpm run build:network    # writes public/data/current/  — must run first
pnpm run build:proposal   # writes public/data/proposed/ — reads public/data/current/
```

`build:proposal` reads `public/data/current/network.json`, `geometry.geojson` and `meta.json`
directly (for stop coordinates, the two lines it carries over unchanged, and to derive its own
feed date and service window — see `docs/proposal-import.md`). Running it against a stale or
missing `current/` produces a stale or broken `proposed/`.

`build:network` accepts two flags, both otherwise defaulting to "trust the cache":

- `--refresh-osm` — re-queries Overpass for route relations instead of reading
  `data/cache/osm/routes.json`. Overpass is slow and rate-limited, so this is worth avoiding
  unless OSM data for these routes has actually changed.
- `--refresh-routing` — re-requests OSRM (bus routing) and the OSM railway graph (rail routing)
  instead of reading the per-pattern cache under `data/cache/routing/`, and forces a fresh
  Overpass railway query too. One request per second against OSRM's public demo server, so a full
  refresh of ~250 patterns takes a few minutes.

`build:proposal` has neither flag: it always reads the OSM relation cache as-is (`refresh: false`)
and always routes fresh via OSRM (`data/cache/routing-proposed/` is keyed separately from
`data/cache/routing/` — see the comment on `ROUTING_CACHE_DIR` in `scripts/build-proposal.ts` for
why sharing the cache would be wrong, not just redundant).

If a fix changes what a converter produces, regenerate and commit the data in its own commit,
separate from the code change, so the diff of the data is reviewable on its own.

### Caches: what's committed, what isn't

| Path                           | Committed?        | What it holds                                                                                                                                                                                                                                                                 |
| ------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/cache/gtfs/`             | No (`.gitignore`) | The downloaded `gtfs.zip` and its extracted CSVs — large, and trivially re-downloaded.                                                                                                                                                                                        |
| `data/cache/osm/`              | Yes               | Overpass responses (route relations, railway ways), keyed by bounding box. Committed so builds work offline and don't depend on a slow, rate-limited public endpoint (decision 10).                                                                                           |
| `data/cache/routing/`          | Yes               | Per-pattern routed geometry for `public/data/current/`, keyed by pattern id plus a hash of the pattern's stop coordinates (so a pattern id reused for a different route across a feed rebuild is a cache miss, not a silently wrong hit).                                     |
| `data/cache/routing-proposed/` | Yes               | Same, for `public/data/proposed/`. Separate directory from `data/cache/routing/` — pattern ids collide between the two scenarios, and sharing the cache would hand a proposed pattern the current scenario's already-routed geometry for a same-numbered but different route. |

## Project layout

```
src/
  data/      scenario loader, frequency expansion, index building, schema validation
  domain/    pure functions — servicesOnDate(), departuresAt(), vehiclesAt(), no map, no React
  map/       MapLibre init, layer definitions, basemap switcher
  ui/        LineBrowser, StopPanel, ClockControls, ScenarioSwitcher, …
  state/     app store (@tanstack/react-store) and the animation clock
scripts/
  build-network.ts    GTFS feed -> public/data/current/
  build-proposal.ts   petition spreadsheet + public/data/current/ -> public/data/proposed/
  gtfs/, osm/, proposal/   converter internals shared or specific to one pipeline
tests/       Vitest — converters, domain logic, state
e2e/         Playwright — production-build smoke tests, driven off the committed data itself
```
