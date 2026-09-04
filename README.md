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

Node and pnpm, and nothing else. In particular:

- **No Python.** `scripts/analysis/*.py` are one-off notebooks used once to reverse-engineer the
  spreadsheet's quirks; nothing in the build, the tests or the site runs them, and they are
  referenced only from comments. You never need a Python interpreter to work on this project.
- **No database, no API keys, no accounts.** Every external service the build touches
  (the operator's GTFS feed, Overpass, OSRM) is public and unauthenticated, and the responses that
  matter are committed to the repo — see [Caches](#caches-whats-committed-what-isnt).
- **Use `pnpm`, not `npm`.** `package.json` pins an exact version via `packageManager`
  (`pnpm@11.1.2+…`); `npm install` ignores that pin entirely and will fight it — install pnpm
  (via [Corepack](https://pnpm.io/installation#using-corepack) or a standalone install) and use it
  for every command below.
- Node ≥ 22.12 (`engines` in `package.json`). CI runs Node 22 specifically (decision 16); a newer
  local Node is fine for everything except matching CI's exact behaviour bit-for-bit.

## Getting started

From a clean machine:

```sh
node --version            # must be >= 22.12
corepack enable           # ships with Node; no separate install

git clone https://github.com/MrCoft/Breclav-MHD-Mapa.git
cd Breclav-MHD-Mapa
pnpm install
pnpm dev                  # Vite dev server on http://localhost:5173
```

Corepack reads the `packageManager` pin out of `package.json` and fetches that exact pnpm the
first time you run `pnpm` inside the repo, so you get the version this project expects rather than
whatever is newest. If you would rather not use Corepack, install pnpm 11 by hand — but do not
substitute `npm`.

Playwright needs its browsers before `pnpm run test:e2e` will run; everything else works without
them:

```sh
pnpm exec playwright install chromium
```

No further setup. The committed data under `public/data/` is what the dev server serves, so the
app is fully working immediately — you only need the converters below if you are changing the data
itself.

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

## Where the data comes from

Two independent sources, one per scenario. This matters because they are updated in different
ways and on different schedules.

| Scenario                            | Shipped as              | Built from                                                                                                                                                                                                                 |
| ----------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Současný stav** (today's network) | `public/data/current/`  | the **IDS JMK GTFS feed** (`config/scope.json` -> `feedUrl`), scoped to routes touching Břeclav, plus OpenStreetMap relations and OSRM/rail routing for the shapes                                                         |
| **Návrh 2026** (the proposal)       | `public/data/proposed/` | the petition's **spreadsheet** (`config/proposal.json` -> `workbook`) and `data/proposed-stops.json`, **plus `public/data/current/`** for stop coordinates, line colours, the two inherited lines and the service calendar |

So the spreadsheet drives the proposal only. It cannot regenerate the whole site: the current
network is a live operator feed, and the proposal build reads that feed's output to place its own
stops and colour its own lines. There is no path from a spreadsheet to `current/`, by design — see
`docs/decisions.md` entry 35.

## Regenerating the data

Generated network data lives in `public/data/<scenario>/` (served by the site) and is committed to
the repo, not built in CI (decision 9, decision 10). Two converters, and **order matters**:

```sh
pnpm run build:network    # writes public/data/current/  — must run first
pnpm run build:proposal   # writes public/data/proposed/ — reads public/data/current/
pnpm run build:data       # both, in that order
```

**Pick the narrowest one that covers what you changed.** `build:network` re-downloads the feed
whenever the operator's copy is newer and takes the shipped `feedDate` from that download, so
running it changes today's network whether or not you meant to. If you only edited the
spreadsheet, run `build:proposal` alone.

Both are idempotent: re-running with unchanged inputs reproduces byte-identical output apart from
`meta.json`'s `generatedAt`.

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

## Updating the proposal spreadsheet

The common case — a new version of the petition's timetable — is one command.

1. Put the new `.xlsx` in `data/`.
2. Point `config/proposal.json`'s `workbook` at it (or pass `--workbook` for a one-off, below).
3. Run it:

```sh
pnpm run build:proposal
```

4. Check the diff of `public/data/proposed/`, run `pnpm test`, and commit the data in its own
   commit, separate from any code change.

To try a file without editing config:

```sh
pnpm run build:proposal -- --workbook data/navrh_2026_v3.xlsx
```

This step usually needs **no network access**: Overpass responses and per-pattern routing are both
read from the committed caches. OSRM is called only for patterns whose stop coordinates changed,
one request per second.

### What a new spreadsheet may change freely

Regenerate and it just works:

- **Any time value**, as an Excel day-fraction or literal `H:MM` text; `~` or blank means the trip
  does not serve that stop.
- **Trips** — how many, their numbers, and which stops each one serves. Route variants become
  separate patterns on their own.
- **Stop order**, and stop rows added or removed, as long as every name still resolves.
- **Which stops are timing points.** The arrival/departure (`příj.`/`odj.`) row pair is detected
  from each trip's own served sequence, so pairs may move, appear or disappear (decision 34).
- **Which lines are imported and what they are called** — `cityLines`, `longNames` and
  `inheritedLines` in `config/proposal.json`.

### What still needs a developer

The build fails loudly on all of these rather than shipping something wrong, except where noted.

| Change                                        | Why it is not just config                                                                                                                                                                                                                                                                     |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A stop name the matcher cannot resolve        | `matchStopName` anchors the row's tokens at the end of an existing stop name; a new spelling or typo needs an entry in `NAME_CORRECTIONS` (`scripts/proposal/stopMatch.ts`). Unmatched and ambiguous names both abort the build, listing every offender.                                      |
| A genuinely new stop                          | Needs a hand-placed `{id,name,lat,lon,note}` in `data/proposed-stops.json` plus a `requiredStopOverrides` entry. The JSON is data; the coordinates are research.                                                                                                                              |
| Anything that moves Mánesova                  | `resolveManesova` hard-codes the neighbouring stop ids that tell the proposal's second pole from the existing one — the two share a name, so nothing else can.                                                                                                                                |
| A line number the GTFS feed has never carried | `buildCityLines` copies mode and colours from the current scenario's line of the same id, and throws if it is absent. Config alone is not enough.                                                                                                                                             |
| A sheet not named exactly after its line      | There is no sheet-name-to-line-id mapping; `561 návrh` or `L561` reads as a missing sheet.                                                                                                                                                                                                    |
| A different sheet layout                      | Column A must hold the row number and the `Tč` header, B the stop name, C the marker, D onward the trips; each sheet must hold exactly two stacked sections, outbound first. **Direction order is assumed, not checked** — a return-first workbook would produce a silently reversed network. |
| Times stored as Excel date+time serials       | Values above 1 are read as kilometre totals, not times, so the sheet parses as having no stops and the build dies with "trips: none produced" — which does not name the real cause.                                                                                                           |
| A file Excel did not write                    | `scripts/proposal/xlsx.ts` reads the archive's XML with regexes that expect Excel's own attribute order. LibreOffice or Google Sheets exports may not match; `.xls` and `.ods` are not readable at all.                                                                                       |
| A weekend or second service                   | One service id and a hard-coded Monday–Friday mask, with dates inherited from the current scenario.                                                                                                                                                                                           |

## Updating today's network

`public/data/current/` follows the operator, not the spreadsheet:

```sh
pnpm run build:network
```

This downloads whatever `kordis-jmk.cz` is serving now, so the shipped `feedDate` moves to that
file's `Last-Modified`. Two consequences worth knowing before you run it:

- **The old feed is not recoverable.** `data/cache/gtfs/` is gitignored and the operator serves
  only the current file, so the download overwrites the only local copy. If you need to compare
  against the previous feed, copy `data/cache/gtfs/gtfs.zip` somewhere first.
- **Service windows move.** A newer feed usually starts on a later date, so deep links to dates
  before it (`?d=2026-09-02`) open on an empty network. That is correct behaviour, not a bug.

## Caches: what's committed, what isn't

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
config/
  scope.json          which feed, which municipality, which bounding box
  proposal.json       which spreadsheet, which lines, what to call them
scripts/
  build-network.ts    GTFS feed -> public/data/current/
  build-proposal.ts   petition spreadsheet + public/data/current/ -> public/data/proposed/
  gtfs/, osm/, proposal/   converter internals shared or specific to one pipeline
tests/       Vitest — converters, domain logic, state
e2e/         Playwright — production-build smoke tests, driven off the committed data itself
```
