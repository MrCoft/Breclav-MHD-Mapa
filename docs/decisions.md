# Decisions

Append-only. Numbered. Never edit or delete a past entry — supersede it with a new one.

Each entry records what was decided, what was rejected, and why.

## 1. Deploy as static files on GitHub Pages

**Decided:** Build to static files and serve from GitHub Pages, Actions as the source.
**Rejected:** Any server-backed deployment.
**Why:** The whole application is a client-side map over a small, pre-baked dataset. Nothing needs a server, and Pages costs nothing. The constraint this imposes — no secrets in the bundle — shaped decision 4.

## 2. Cover every route touching Břeclav

**Decided:** All routes serving a Břeclav stop, kept whole: city MHD 561–569, regional buses, and trains S8/S9/S51/R13/R50 out to Brno, Znojmo and Staré Město.
**Rejected:** City MHD only; MHD plus regional buses without trains.
**Why:** The user wants to reason about the town's transport as a whole, and the trains are part of how people actually leave and enter Břeclav. Keeping routes whole rather than clipping them at the town boundary avoids lines that stop in mid-air.

## 3. Route geometry from OpenStreetMap relations at build time

**Decided:** Fetch OSM route relations via Overpass during the converter run, stitch their ways into polylines, trim each to the stops its pattern serves. Fall back to straight stop-to-stop lines, with per-pattern manual overrides taking precedence.
**Rejected:** Straight lines only; no route lines at all; map-matching through a routing engine.
**Why:** The IDS JMK feed ships no `shapes.txt`, so geometry has to come from somewhere. Straight lines are unacceptable once trains are in scope — rail would visibly cut across countryside. A routing engine was the most accurate option but adds a heavy external dependency for a marginal gain over OSM relations, which humans have already drawn correctly for these exact lines.

## 4. MapLibre GL JS with OpenFreeMap tiles

**Decided:** MapLibre GL JS rendering OpenFreeMap vector tiles.
**Rejected:** Self-hosted Protomaps PMTiles extract; Leaflet with raster tiles; MapLibre with a MapTiler key.
**Why:** Decision 1 means no secret can be hidden, which rules out any keyed provider. OpenFreeMap needs no key and no account. PMTiles would remove the third-party dependency entirely but puts a 100–300 MB binary in git for a region this size. Raster tiles via Leaflet were the fallback if vector had failed.

## 5. No live vehicle positions

**Decided:** Static scheduled data only.
**Rejected:** Live vehicle tracking over the ArcGIS StreamServer WebSocket at `wss://gis.brno.cz/geoevent/ws/services/Kordis_stream/StreamServer/subscribe`, which was investigated and confirmed working with no authentication.
**Why:** The project's purpose is comparing the current network against a proposed redesign. A proposed network has no vehicles and never will, so a live layer would work on exactly half the product. The investigation is preserved in the spec's Appendix A because the finding is non-obvious and may matter for a different project.

## 6. A purpose-built network format, not GTFS in the browser

**Decided:** The converter emits a small scenario bundle (`network.json` + `geometry.geojson` + `meta.json`) that the client reads. Scenarios are swapped by dropping in a directory.
**Rejected:** Shipping filtered GTFS to the browser and parsing it there; building an in-app network editor.
**Why:** The proposed network will be written by hand. GTFS is hostile to hand-authoring — a redesign would mean writing `stop_times.txt` by row. An in-app editor solves that properly but is several times the scope of everything else here; it becomes viable once this format has proven itself.

## 7. Collapse platform stops to parent stations

**Decided:** Every `stop_times` reference resolves to its `parent_station` before any other processing. Platform-level detail is not retained.
**Rejected:** Keeping platform-level stops.
**Why:** The feed is platform-level — six distinct `stop_id`s share one coordinate at Břeclav bus station. Uncollapsed, the map draws overlapping duplicate markers and a stop's departures fragment across platforms. This map answers "where does this line go", not "which bay does it leave from".

## 8. Run times hoisted to the pattern, overridden per trip

**Decided:** Each pattern carries its group's most common run-time vector; a trip whose run times differ carries its own `offsets` array.
**Rejected:** Storing an absolute time per stop per trip, as GTFS does.
**Why:** It collapses the majority of trips to a single integer each. Measurement tempered the framing: deviation is common, not exceptional, so the override path is a normal case with its own tests rather than a rare fallback. Regenerate the figures with `npm run build:network`, which prints them.

## 9. Bake the data once; no scheduled refresh

**Decided:** The converter runs by hand via `npm run build:network`. A single CI workflow builds and deploys on push.
**Rejected:** A weekly cron workflow that regenerates the data and commits it.
**Why:** The user asked for it. The upstream feed rebuilds weekly, so data will drift; `meta.json` records the feed date and the UI footer displays it, making staleness visible rather than silent.

## 10. Commit generated data to the repo

**Decided:** `public/data/**` and the Overpass cache under `data/cache/osm/` are committed. Extracted GTFS CSVs are not.
**Rejected:** Generating data at build time in CI.
**Why:** The site builds with no network access, and a timetable change shows up as a reviewable git diff. For a project whose subject is how a network changes, a diff of the network is a feature. Overpass is slow and rate-limited, so caching its response is what makes builds reproducible.

## 11. Validate the network in the browser, not only in the converter

**Decided:** `loadScenario` calls `validateNetwork`, accepting ajv in the client bundle.
**Rejected:** Restricting validation to the converter and tests to keep the bundle smaller.
**Why:** The point of the format is that a human writes the next scenario by hand. Validation is what turns a malformed hand-authored file into a readable error banner instead of an opaque crash. Roughly 30 KB gzipped on a static site with no bandwidth pressure. Reversible by gating validation behind `import.meta.env.DEV`.

## 12. No `listScenarios` until something consumes it

**Decided:** The client does not ship a scenario-listing function. `public/data/scenarios.json` is still generated.
**Rejected:** Shipping the function ready for the future comparison UI.
**Why:** Nothing consumes it until the comparison UI exists, and unused exported code is dead weight. The data file costs nothing; the function is three lines when needed.

## 13. URL state restores date and time independently

**Decided:** `?d=` and `?t=` are each restored on their own.
**Rejected:** Restoring the moment only when both parameters are present.
**Why:** The store already defaults the date to today, so a bare `?t=07:30` is unambiguous. The coupled condition silently dropped valid links.

## 14. Accept the double build in CI

**Decided:** Playwright's `webServer` builds the site, and the workflow builds again for the Pages artifact.
**Rejected:** Reusing the deploy build's output for the e2e run.
**Why:** Sharing one build couples the e2e step to the deploy step's ordering. Roughly a minute of CI time buys that independence.

## 15. Implementation commits go directly to `main`

**Decided:** No worktree, no feature branch.
**Rejected:** An isolated worktree; a `feat/mhd-mapa` branch.
**Why:** The user's call. For a greenfield repo whose `main` held only documentation, branch isolation protects nothing.

## 16. CI runs Node 22, not the local Node 26

**Decided:** `deploy.yml` pins `node-version: '22'`.
**Rejected:** Matching the local development Node major.
**Why:** Node 22 is LTS and clears Vite 7's floor. The versions that actually decide build behaviour — TypeScript, Vite — are pinned by `package-lock.json`, not by the runner's Node major.

## 17. Adopt the Ai-Config project guidelines

**Decided:** `CLAUDE.md` at the repo root, composed from `Ai-Config/Templates/_shared` plus `Templates/React-Web-App`, with the `ai-config:template` markers preserved so the user's sync tooling can update it.
**Rejected:** Copying the older rendered `CLAUDE.md` from `Hearthstone-Clone/…/Editor Frontend`, which is a stale five-line version that contradicts the current template on committing and code generation.
**Why:** The user asked for the guidelines to be adopted. Copying from the template source rather than a rendered downstream copy means this file matches what their tooling would generate. This project is a React web app, so `React-Web-App` is the right stack template.
