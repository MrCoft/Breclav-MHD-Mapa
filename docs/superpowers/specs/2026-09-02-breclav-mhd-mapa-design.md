# Břeclav MHD Mapa — Design

Date: 2026-09-02
Status: Approved, ready for implementation planning

## Goal

An interactive web map of public transport serving Břeclav, deployed as static files on
GitHub Pages. The rendered network is data, loaded from a swappable scenario file, so an
alternative proposed network can later be visualised through the same UI without code
changes.

## Scope

In scope for v1:

- All 20 routes touching Břeclav: city MHD (561–569), regional buses (542, 570–574 and
  others), and trains (S8, S9, S51, R13, R50). Routes are kept whole, so line 570 retains
  its Mikulov end and R50 retains Brno.
- Three views: line browser with highlight, stop detail panel, and a departure board for a
  chosen date and time.
- Static scheduled data only.

Out of scope for v1:

- Live vehicle positions and realtime delays. Investigated and confirmed available (see
  Appendix A), then dropped: the project's purpose is comparing network designs, and a
  proposed network has no live feed.
- Current-vs-proposed comparison UI (toggle, split view, or diff overlay). The data format
  is built to support it; the UI is deferred until the proposed network exists.
- Journey planning and routing between stops.
- Parallel-line offsetting where routes share a street (see Known Limitations).

## Data sources

Static timetables: `https://kordis-jmk.cz/gtfs/gtfs.zip`, ~11 MB, CC-BY-4.0, rebuilt weekly
on Sunday at 12:00 by KORDIS JMK.

The feed omits `shapes.txt`, so route geometry is not published and must come from
OpenStreetMap route relations.

Measured subset of the feed for routes touching Břeclav:

| Metric | Full feed | Břeclav subset |
| --- | --- | --- |
| Routes | — | 20 |
| Trips | 71 981 | 1 844 |
| `stop_times` rows | 1 230 372 | 23 273 |
| Stops, platform level | 7 680 | 380 |
| Stops, parent stations | 3 258 | 164 |
| Patterns | — | 252 |

The subset is small enough to ship as a single bundle, expected around 300 KB gzipped. No
lazy loading, data tiling, or server component is needed.

**The feed is platform-level.** Every `stop_times` row references a platform
(`location_type=0`) which belongs to a parent station (`location_type=1`). Six distinct
platform ids share one coordinate at Břeclav bus station. The converter therefore collapses
every stop reference to its `parent_station` before doing anything else; without this the
map draws overlapping duplicate markers and a stop's departures fragment across platforms.
Collapsing takes the subset from 380 stops to 164. Platform-level detail is not retained —
this map shows where a line goes, not which bay it leaves from.

## Network data format

The swappable unit is a scenario directory. Swapping networks means dropping in a folder.

```
public/data/
  scenarios.json          # [{id: "current", label: "Současný stav"}, ...]
  current/
    network.json
    geometry.geojson
    meta.json             # source feed date, generated-at, converter version
```

`network.json` holds five collections:

```jsonc
{
  "stops": [
    { "id": "s-brec-an", "name": "Břeclav, aut.nádr.", "lat": 48.7553, "lon": 16.8823,
      "zone": "575", "wheelchair": true }
  ],
  "lines": [
    { "id": "563", "name": "563", "longName": "Břeclav: Aut. nádraží - Poštorná, FOSFA",
      "mode": "bus", "color": "#2C89C8", "textColor": "#FFFFFF" }
  ],
  "patterns": [
    { "id": "563-out", "line": "563", "direction": 0, "headsign": "Poštorná, FOSFA",
      "stops": ["s-brec-an", "s-brec-post", "s-brec-fosfa"],
      "offsets": [0, 4, 9] }
  ],
  "services": [
    { "id": "weekday", "days": [1,1,1,1,1,0,0],
      "from": "2026-08-30", "to": "2026-12-12",
      "added": ["2026-11-17"], "removed": ["2026-12-24"] }
  ],
  "trips": [
    { "pattern": "563-out", "service": "weekday", "start": 374 }
  ]
}
```

Design decisions:

**Run times live on the pattern, not the trip.** GTFS stores an absolute time per stop per
trip — 23 273 rows for this subset. The most common run-time vector is hoisted to the
pattern, letting a trip that uses it collapse to a single start integer. A trip with
different run times carries its own `offsets` array, which overrides the pattern's.
Measured on the real feed, 1 150 trips take the hoisted vector and 694 carry an override.

**Times are integer minutes since midnight**, not strings. GTFS legitimately emits values
such as `25:10:00` for post-midnight departures; integers represent these directly with no
string parsing and no date arithmetic in the client.

**Geometry is a separate file**, keyed by pattern id. Coordinate arrays are most of the
bytes and none of the meaning. Keeping them out leaves `network.json` diffable and
hand-editable, and lets a proposed route be drawn in geojson.io and pasted in.

**Frequency blocks** are supported as an alternative to explicit trips:

```jsonc
{ "service": "weekday", "from": 300, "to": 1320, "headway": 20 }
```

These expand to trips at load time. The current network does not use them, since GTFS
supplies explicit trips. They exist so a proposed network can be authored as "every 20
minutes, 05:00–22:00", which is the form a redesign is actually conceived in.

The format is locked by a JSON Schema, validated by the converter and by tests.

## Build pipeline

`scripts/build-network.ts`, run manually via `npm run build:network`. Generated output is
committed to the repo.

Two directories are involved and should not be confused: repo-root `data/` holds build
inputs and caches (never served), while `public/data/` holds the generated scenario output
(served by the site).

**Stage 1 — fetch and filter.** Download `gtfs.zip`, conditional on `Last-Modified`.
`stop_times.txt` is 50 MB unzipped and is streamed, never held fully in memory. Two passes:

1. Every stop reference is resolved to its `parent_station` (falling back to the stop's own
   id when it has no parent). All later stages work exclusively in parent-station ids.
2. Stations whose municipality (the substring before the first comma) is `Břeclav` → trips
   touching those stations → the set of route ids.
3. Every trip belonging to those routes is kept in full.

A parent station inherits `zone` and `wheelchair` from its first child platform, since those
attributes are recorded at platform level.

The municipality match is a config value in `config/scope.json`, not a constant, so
widening scope is a config edit.

**Stage 2 — patterns.** Trips are grouped by `(route, direction, exact stop sequence)` over
parent-station ids, yielding 252 patterns averaging 13.7 stops. The group's modal run-time
vector becomes the pattern `offsets`; deviating trips emit their own `offsets` array.

Deviation is common rather than exceptional: 694 of 1 844 trips (38%) carry an override,
drawn from 316 distinct vectors. The scheme still pays — the remaining 1 150 trips collapse
to a single integer each — but the implementation must treat the override path as a normal
case with its own tests, not as a rare fallback.

`calendar.txt` and `calendar_dates.txt` fold into the `services` collection.

**Stage 3 — geometry.** For each pattern, in priority order:

1. **Manual override** — `data/geometry-overrides/<pattern>.geojson` if present, always wins.
2. **OSM route relation** — Overpass query by `type=route`, `network="IDS JMK"`,
   `ref=<line>`, within a bbox around the configured scope. Relation members are ways in
   arbitrary order and orientation, so they are stitched endpoint-to-endpoint into a single
   polyline. Each pattern stop is then projected onto that polyline and the geometry is cut
   between the first and last projection. This is what gives short-turn variants such as
   563 and 568 correct and different lengths from one shared relation.
3. **Straight stop-to-stop fallback** — always succeeds.

The build reports which patterns fell back to straight lines. That report is the
manual-override worklist.

Overpass responses cache to `data/cache/osm/` and are committed, so builds are reproducible
and do not depend on a slow, rate-limited public endpoint. `--refresh-osm` re-queries
deliberately.

Trains use this same path; OSM carries `route=train` relations tagged for IDS JMK, so
S8/S9/S51/R13/R50 need no special handling beyond the mode tag.

**Stage 4 — emit and validate.** Write `network.json`, `geometry.geojson`, `meta.json`.
Validate against the JSON Schema and assert sanity bounds: route count within an expected
band, no empty patterns, plausible stop count, no pattern missing geometry. Violations fail
the run rather than writing output.

All output is sorted deterministically so regeneration produces minimal diffs.

## Client application

Vite + TypeScript + React + MapLibre GL JS. Basemap is OpenFreeMap vector tiles: no API key,
which matters because GitHub Pages cannot hold a secret.

State lives in a Zustand store rather than React context, so map layer code can read
selection without being a component.

**MapLibre is driven imperatively.** The map instance lives in a ref and is never
re-created; React effects push state into it via `setFilter` and `setPaintProperty`.
Wrapping MapLibre in declarative components is the common route to slow, buggy behaviour.

```
src/
  data/      scenario loader, frequency expansion, index building
  domain/    pure: servicesOnDate(), departuresAt(), patternsForStop()
  map/       map init, layer definitions, highlight sync
  ui/        LineBrowser, StopPanel, TimeControl
  state/     selection store
```

`domain/` contains pure functions over plain data — no map, no React, no fetch. Every
correctness question lives there, which is what makes it directly testable.

**Rendering.** Two GeoJSON sources: 380 stop points and roughly 100 pattern lines. Line
colour comes from feature properties rather than per-layer styling, so 20 routes need one
layer rather than 20.

**Highlight** works by filter, never by rebuilding sources: a dimmed grey layer showing
everything, a coloured layer filtered to the selected line, and a stops layer filtered to
that line's stops. Selecting a line is two `setFilter` calls.

**Departure board.** The user picks a date and time, defaulting to the current time in
Europe/Prague. Active services for that date are resolved from the day mask plus `added`
and `removed` exceptions. For each `(pattern, stopIndex)` touching the stop, every trip's
departure is `trip.start + offsets[stopIndex]`, then filtered and sorted. With 1 844 trips
this is brute force in well under a millisecond; no index structure is worth the complexity.

The significant correctness trap: GTFS represents post-midnight departures as minutes ≥ 1440
belonging to the *previous* service day. A naive implementation silently drops the 00:20
night bus. The query therefore also evaluates the previous service day, shifted by 1440.

**URL state.** Scenario, line, stop, and time are held in the query string, making any view
linkable. This matters for a project whose purpose is arguing about a network.

Czech-only UI; no i18n layer. Vite `base` is set to `/Breclav-MHD-Mapa/` for the Pages
subpath.

The footer displays the source feed date from `meta.json`, so stale data is visible rather
than silently wrong.

## Deployment

A single workflow, `deploy.yml`, triggered on push to `main`: install, test, build,
`actions/upload-pages-artifact`, `actions/deploy-pages`. A concurrency group prevents
overlapping deploys racing.

Pages source is set to **GitHub Actions**, not a branch — no `gh-pages` branch and no
committed `dist/`.

The workflow needs `pages: write` and `id-token: write`. It never writes to the repository
and never fetches upstream data; network data is baked once by the converter and committed.

## Testing

Vitest, written test-first.

- `servicesOnDate` — weekday, weekend, a `removed` holiday, an `added` working Saturday, and
  both ends of the validity range.
- `departuresAt` — normal case; the post-midnight case using a real trip with minutes ≥ 1440
  taken from the feed; a stop with no service on the chosen day; the last departure of the
  day.
- Frequency expansion — a headway block produces the correct trip count and start times.
- Converter — against a small hand-built fixture GTFS rather than the 11 MB feed: pattern
  grouping, modal offset selection, and correct override emission for a deviant trip.
- Geometry stitching — ways supplied out of order and reversed must yield one correct
  polyline; trimming must give 563 and 568 different lengths from a shared relation.
- Schema — a known-bad network must fail validation.

One Playwright smoke test, not a suite: load the page, select line 563, click a stop, assert
departures render. This catches integration breakage that unit tests structurally cannot.

## Error handling

- A missing or corrupt scenario file shows an error banner, not a blank map.
- A stop with no service on the chosen day displays "dnes nejede" rather than an empty list,
  which would read as a bug.
- If OpenFreeMap is unavailable, routes and stops still render on an empty background.
- Overpass failure during a manual data rebuild fails the converter run; the committed cache
  means the site still builds.

## Known limitations

**Overlapping routes.** Where many lines share one street — which in central Břeclav is most
of them — the drawn routes overlap into a single blob. Proper transit-map rendering offsets
parallel lines using `line-offset`, ranked per shared segment, which requires segment-level
deduplication across patterns. This is real work, and the line-browser highlight keeps the
map readable without it. Deferred to v2.

**Geometry match quality.** OSM relation matching by `ref` and `network` will not resolve
every pattern. The build reports fallbacks, and manual overrides exist to fix them
individually.

## Appendix A: realtime investigation

Recorded because the finding is non-obvious and may matter later.

Live vehicle positions for the whole IDS JMK network are publicly available with no
authentication, via an ArcGIS StreamServer WebSocket:

```
wss://gis.brno.cz/geoevent/ws/services/Kordis_stream/StreamServer/subscribe
```

Verified working on 2026-09-02. Each message is one vehicle as JSON with fields `ID`, `Lat`,
`Lng`, `Bearing`, `LineID`, `LineName`, `RouteID`, `Course`, `Delay`, `LastStopID`,
`FinalStopID`, `LF` (low-floor), `IsInactive`, `TimeUpdated`.

Related endpoints and their status at time of investigation:

- `https://gis.brno.cz/ags1/rest/services/Hosted/ODAE_public_transit_positional_feature_service/FeatureServer/0`
  — the polling equivalent. Returns empty result sets and its layer metadata errors; the
  backing big-data store appears broken.
- `https://kordis-jmk.cz/gtfs/gtfsReal.dat` — GTFS-Realtime protobuf, ~250 KB. Serves **no**
  `Access-Control-Allow-Origin` header, so a browser cannot fetch
  it directly. `gis.brno.cz` does send permissive CORS headers.

Joining a live vehicle to a GTFS trip requires the non-standard `api.txt` file inside
`gtfs.zip`, which maps `Linka/CVlaku` (the stream's `LineID` and `Course`) to `trip_id`.
