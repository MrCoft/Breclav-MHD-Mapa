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

## 18. The proposal is Prinz's petition attachment; Návrat is the rival it is costed against

**Decided:** The eight per-line sheets in `data/navrh_2026_new2.xlsx`, and the timetables in
`data/jizdni_rady_2026.pdf`, are one proposal — titled "Prinz návrh jízdních řádů 2026",
described in the PDF as *Příloha k petici* (an attachment to a petition). "Návrat" is the
alternative it is costed against in the summary sheet; only its kilometres exist, not its
timetables.
**Rejected:** Treating the two summary columns as two importable networks.
**Why:** The PDF's own title page settles what the spreadsheet only implied. The proposal
states it is built on the same total kilometres as the alternative, which is why the two
totals nearly match (2271 vs 2267.7). Návrat cannot be mapped without timetables that do not
exist in any supplied file.

## 19. The comparison filters to city lines and to a school-term weekday

**Decided:** In comparison mode both scenarios are restricted to city lines 561–569, and the
date is locked to a school-term weekday. The standalone map still shows all 20 routes and all
day types.
**Rejected:** Comparing full networks, which would render every regional line and train as
"deleted"; carrying the current weekend timetable into the proposed scenario, which would
invent service the proposal never states.
**Why:** The user's call on both. The proposal covers only city lines and only weekdays
("Uvedený návrh je určen pro všední dny"), so anything wider is comparing unlike things.

**Known wrinkle, not yet resolved:** the proposal does change two regional lines — it cancels
564 and replaces it with 574, and has 571 stop at all intermediate stops. A strict city-lines
filter hides both changes. See `docs/open-questions.md`.

## 20. The spreadsheet is the import source; the PDF is narrative and cross-check

**Decided:** The proposed-scenario importer reads `data/navrh_2026_new2.xlsx`.
`data/jizdni_rady_2026.pdf` supplies the rationale, the direction labels ("opačný směr") and a
validation cross-check.
**Rejected:** Importing from the PDF as the primary source.
**Why:** The spreadsheet is cell-addressed structured data; the PDF is text whose columns are
recovered by whitespace alignment, which is fragile. The PDF is better for the things the
spreadsheet lacks: which sheet is which direction, per-trip kilometres, and the prose
description of what is being changed and why.

## 21. Adopt the reference project's frontend stack, minus its server layer

**Decided:** Bring this project onto the same toolchain as the user's Hearthstone Clone Editor
Frontend: pnpm, Tailwind 4, shadcn/ui (radix-ui, class-variance-authority, clsx,
tailwind-merge, lucide-react, tw-animate-css), Storybook 9 with addon-themes, ESLint 9 with
`@tanstack/eslint-config`, that project's exact Prettier config, Vitest with jsdom and Testing
Library, `@tanstack/react-store` in place of Zustand, fontsource variable fonts, `@/` path
aliases.
**Rejected:** `@tanstack/react-start` and `nitro`, the `start` script, the Dockerfile;
`orval`, `axios` and `@tanstack/react-query`; `react-hook-form`, `@hookform/resolvers` and
`zod`; `@faker-js/faker`; `@tanstack/react-router`; `@tanstack/react-table`; `vite-imagetools`
and `@unpic/react`; the YAML and JSON-schema generation plugins.
**Why:** The user asked for the stack. The exclusions are not preference — TanStack Start with
Nitro is a server-rendered framework whose build produces `.output/server/index.mjs`, and this
project's first decision was static hosting on GitHub Pages, where no server runs. The rest of
the exclusions are packages that exist to talk to a backend this project does not have
(`orval`, `axios`, Query), to build forms it does not contain (react-hook-form, zod), or to
solve problems it does not have (routing for a single view, a table library for a
twelve-row departure list, image tooling for an app with no raster images).

Supersedes the Zustand choice implied by the original plan, and resolves open question 1: the
project now has a linter, so "the full check" means typecheck, lint and tests.

## 22. Adopt the reference project's code conventions

**Decided:** No semicolons, single quotes, trailing commas, tab width 4, print width 120.
React components are arrow functions (`react/function-component-definition`). No default
exports under `src/` except Storybook stories and ambient declaration files
(`import/no-default-export`). Tailwind size utilities stop at roughly `w-8`; anything larger is
expressed in pixels.
**Rejected:** Keeping the formatting Tasks 1–3 were written in.
**Why:** The point of copying a stack is that code moves between the two projects without
reformatting churn. The cost is a one-off mechanical reformat of existing code, kept in its own
commit so the history stays readable.

## 23. Animate vehicles from the timetable, with a synthesized motion profile

**Decided:** Vehicles are simulated from the scheduled timetable, not fetched. A trip's position
at time *t* is found by locating *t* between two consecutive stop times and interpolating along
the pattern's polyline. Motion within a segment follows a trapezoidal speed profile: dwell at
the stop, accelerate, cruise, decelerate.
**Rejected:** Linear interpolation between stops; live vehicle positions (already rejected in
decision 5, and unavailable for the proposed network).
**Why:** The format stores one time per stop — the departure — so dwell time is not in the data
and must be synthesized. A trapezoid is the smallest model that produces believable motion from
departure-only data. Two degenerate cases are handled explicitly rather than ignored: dwell is
clamped to a fraction of the segment's time, because minute-resolution timetables routinely put
stops 60 seconds apart; and a segment too short for a full trapezoid degrades to a triangular
profile with no cruise phase.

## 24. Geometry carries each stop's distance along its pattern

**Decided:** `geometry.geojson` features gain `stopDistances: number[]` — metres along the
polyline for each of the pattern's stops, same length and order as `pattern.stops`.
**Rejected:** Computing the projection in the browser at load time.
**Why:** The converter already projects every stop onto the line in order to trim it
(decision 3), so the distances are a by-product it currently discards. Recomputing them in the
client would mean shipping a projection routine and paying for it on every load, to derive
numbers the build already knew. This is what makes vehicle animation a lookup rather than a
geometry problem.

## 25. The animation clock lives outside React

**Decided:** A simulation clock — date, fractional minutes, playing state, speed multiplier —
is driven by `requestAnimationFrame` outside React. It updates the vehicle GeoJSON source
imperatively via MapLibre, and pushes a coarse update into the store only when the simulated
minute changes.
**Rejected:** Holding the clock in the component store and re-rendering per frame.
**Why:** At 60fps a store write per frame re-renders every subscribed panel sixty times a
second to move some dots. The panels only care about whole minutes. This keeps the same
imperative-MapLibre discipline already chosen for highlighting.

## 26. Countdowns are shown selectively, not on every stop

**Decided:** The next-arrival countdown always shows for the selected stop, and for all stops
above a zoom threshold.
**Rejected:** A live countdown on all 164 stops at every zoom.
**Why:** 164 simultaneous countdowns is unreadable at city zoom and repaints a symbol layer
every second to render text nobody can distinguish. Selection and zoom are the two signals that
say which stops the user actually cares about.

## 27. A basemap switcher, from keyless sources only

**Decided:** The user can switch basemap. Verified working and keyless on 2026-09-02:

| Option | Source | Note |
| --- | --- | --- |
| Liberty | `https://tiles.openfreemap.org/styles/liberty` | default, detailed vector |
| Positron | `https://tiles.openfreemap.org/styles/positron` | pale; transit lines read best against it |
| Bright | `https://tiles.openfreemap.org/styles/bright` | |
| Dark | `https://tiles.openfreemap.org/styles/dark` | pairs with the Storybook dark theme |
| Satellite | Esri `World_Imagery` raster tiles | attribution required |
| Hillshade | AWS `elevation-tiles-prod` terrarium DEM | MapLibre `encoding: 'terrarium'` |

**Rejected:** MapTiler and any other keyed provider.
**Why:** Decision 1 puts the bundle on GitHub Pages, where every shipped string is public, so a
keyed tile provider is not an option. All six sources above were checked with a live request
before being offered.

**Caveat recorded deliberately:** Břeclav sits in the Dyje floodplain at roughly 155 m and is
almost perfectly flat. 3D terrain and hillshade will show close to nothing there. The DEM source
is listed because it works and costs nothing to wire up, not because it will look impressive.

The switcher must re-add the transit sources and layers after every style change — MapLibre
drops all custom sources and layers when `setStyle` runs, which is the classic bug in
style-switching map apps.

## 28. Route patterns along real infrastructure, adding a routing tier

**Supersedes part of decision 3.**

**Decided:** Geometry is resolved in four tiers: manual override, OSM route relation, **routed**,
straight line. The new routed tier sends a pattern's stops through OSRM's public demo server for
buses, and through a Dijkstra shortest path over an OSM railway graph for trains. Results are
cached per pattern and committed.
**Rejected:** Leaving straight lines as the fallback; replacing the relation tier with routing.

**Why the relation tier survives.** A route relation is the published route. It knows about
bus-only links and one-way loops that a road router smooths over, so where a relation fits it is
better evidence than a routed path. It stays first among the automatic tiers.

**Why routing was needed at all.** Decision 3 assumed a relation could be trimmed to each
pattern. Measured on the real data, that holds for 93 of 192 bus patterns and 34 of 60 rail. The
failures are not missing data — line 572 has 16 patterns matched and 36 not, from the same
relation. A line carries one relation per direction, but many pattern variants: short-turns,
loops, peak deviations. Each variant fails the proximity or monotonic check and falls to a
straight line across open country, which is what the user saw and objected to.

Routing between consecutive stops needs no relation to cover the pattern, only the underlying
network, so it handles every variant.

**Why rail needs its own router.** OSRM has no rail profile. R13 and R50 have no OSM route
relation either, which is why they were the long straight lines cutting across fields to Brno
and Hodonín. A graph over `railway=rail` ways plus Dijkstra is small and self-contained.

**`stopDistances` come out of the routers directly** — OSRM's cumulative leg distances, or the
cumulative path length at each snapped node — rather than being re-projected, which keeps them
exact for the vehicle animation that will consume them.

**Cost if wrong:** the routed geometry may differ from the true bus path where a driver takes a
street the router avoids. That is still a road, and still a large improvement on a line drawn
through a field. Manual overrides remain the escape hatch.

## 29. The app must work on mobile

**Decided:** A dedicated responsive pass, and touch-friendly interaction built into new controls
from the start rather than retrofitted.

The current layout assumes a desktop: `grid-cols-[280px_1fr]` with a fixed 280 px sidebar, and a
stop panel floating at 320 px wide over the map. Task 16's review noted that narrow-viewport
behaviour was never actually verified, only assumed.

What the pass has to cover: the line browser becoming a drawer rather than a permanent column;
the stop panel becoming a bottom sheet; touch targets of at least 44 px; `dvh` instead of `vh`,
because a mobile address bar makes `100vh` taller than the visible viewport and pushes controls
off-screen; and the map keeping usable room once panels are open.

**Rejected:** treating it as CSS polish at the end. The clock controls are being built now, and
building them desktop-only would mean rebuilding them.

**This raises the stakes on open question 14.** The geometry payload is 1.07 MB gzipped, which is
a different proposition on a phone than on a desktop. Deciding whether to simplify the routed
geometry is no longer a matter of taste — it should be measured on a real device.

## 30. Stop countdowns (decision 26) are dropped from v1, not built

**Supersedes decision 26.**

**Decided:** No live "next arrival in N min" countdown ships in v1, on any stop, at any zoom.
Decision 26 specified showing one for the selected stop and for all stops above a zoom threshold;
neither half was ever implemented — `grep -rn countdown src/` returns nothing.
**Rejected:** Implementing it now as part of a review-fix pass; silently leaving decision 26
standing as if it described shipped behaviour.
**Why:** A live countdown is a real feature — a repaint on a timer, a chosen refresh cadence, and
a decision about what "live" even means for scheduled-only data with no delay model (open question
12) — not a one-line fix, and it touches the same map stop layer as concurrent work already in
flight on this branch. `StopPanel`'s departure board already answers "when does the next bus
leave this stop", on demand rather than continuously, which covers the need decision 26 was
reaching for. Revisit as a scoped task if a continuously-updating countdown turns out to matter
enough to justify the added repaint cost decision 26 itself flagged as the reason to be selective.

## 31. The basemap switcher ships two of the six basemaps decision 27 verified

**Supersedes decision 27.**

**Decided:** `src/map/basemaps.ts`'s `BASEMAPS` offers exactly two choices — "Mapa" (OpenFreeMap
Bright, `style.ts`'s `BASEMAP_STYLE`) and "Satelitní" (Esri World Imagery raster). Positron, Dark,
Liberty and the terrarium hillshade DEM, all verified working and keyless in decision 27, were
never wired into the switcher.
**Rejected:** Adding the remaining four now as part of a review-fix pass; leaving decision 27
standing as a description of what ships rather than what was checked.
**Why:** Two is the pairing users already know from Google Maps — a drawn map and satellite
imagery — and was evidently judged enough for v1. The other four remain fully specified in
decision 27's own table (URLs and all) and need no re-verification, only `BasemapOption` entries
in `basemaps.ts`, so re-adding any of them is a small, low-risk follow-up rather than a rebuild —
worth doing if a reviewer wants the pale ground `mapColor`/`casingColor` were originally tuned
against back as an option (`style.ts`'s own comment on `BASEMAP_STYLE`), or the dark pairing for
the Storybook dark theme.

## 32. A stop visit carries an arrival and a dwell; layovers between trips are never shown

**Supersedes the implicit model behind decisions 23 and 24**, which assumed one time per stop.

**Decided:** `Pattern.offsets` and `Trip.offsets` change meaning from departure minutes to
**arrival** minutes, and both gain an optional parallel `dwells` array giving the minutes a
vehicle stands at each stop. Departure from stop `i` is `offsets[i] + (dwells?.[i] ?? 0)`, travel
on segment `i` occupies `offsets[i + 1] - departure(i)`, and a trip's on-screen window is
`offsets[0]` to `offsets.at(-1)` — so a vehicle appears when it pulls out of its first stop and
vanishes the moment it arrives at its last.

Both importers apply the same three rules, which is where "never shown" is actually enforced:

- **first stop** — `offsets[0]` is the departure and `dwells[0]` is 0, so a vehicle standing at
  its origin before the trip starts is not drawn;
- **intermediate stops** — `offsets[i]` is the arrival and `dwells[i]` the scheduled wait;
- **last stop** — `offsets[n]` is the arrival and `dwells[n]` is 0, so the terminus layover is
  dropped entirely.

`vehicleForTrip` holds a vehicle at stop `i` for `max(realDwell, syntheticDwell)`, where the
synthetic figure is the existing `dwellSeconds`/`dwellFraction` pause. Where the feed gives a real
dwell (always a whole minute, so always larger) the real one wins; where it gives none the
behaviour is unchanged from before.

**Rejected:** *Reading `departure_time` only and skipping segments that look implausible* — the
user's first instinct, and the reason this entry exists. Nothing in the feed is missing or
corrupt; the correct number is present and unread, so skipping would guess where the truth is
available. It also needs a threshold nothing can justify (45 segments legitimately run under
10 km/h) and has no good render: hiding the vehicle removes 42% of the buses on screen at 10:00,
teleporting makes it jump, and inventing a speed just moves the error one stop along.

**Rejected:** *One number per stop, taking `arrival_time` except at the first stop.* One line to
change and it kills the reported symptom just as completely (1 segment under 5 km/h, against 133
before). But it folds each stop's wait into the leg approaching it, so 129 segments still crawl in
— R50 covers the 2458 m into Brno hlavní nádraží at 11.3 km/h instead of arriving at 29.5 km/h and
standing for 8 minutes with passengers aboard. It also leaves the proposal workbook's `příj.`/`odj.`
pair as two separate stops (known bug 7), which carrying a dwell collapses for free.

**Why:** the distinction the user drew is between a journey a passenger takes and a movement the
operator makes. A wait in the middle of a trip is part of the ride — the doors open, people are
aboard, and the timetable prints both times. A wait at the terminus is the operator parking a
vehicle until its next duty, or swapping it for a different one entirely, and no passenger relates
to it. One number per stop cannot express that difference; two can, and the split falls exactly on
the line between the two kinds of standing still.

## 33. The geometry length gate scales with line length

**Supersedes the rationale attached to `GEOMETRY_LENGTH_TOLERANCE_METRES`** in
`scripts/build-network.ts`. Prompted by known bug 9.

**Decided:** the check comparing a pattern's final `stopDistance` against its own simplified
line's length uses `6 m + 0.2 m/km` instead of a flat 20 m.

The floor is three times `config/scope.json`'s `geometrySimplifyMetres` (2 m) — one cut corner can
shorten a line by roughly twice the simplification tolerance, and the third multiple covers
haversine round-trip slack on repeated additions. The per-kilometre term is the worst relative
shortening measured on lines long enough for it to dominate the floor (132-177 ppm across the
`R13` patterns), rounded up to 200 ppm.

Verified against all 300 committed patterns in both scenarios: every one passes, and the closest
is `R13-1-1` at 59% of its budget (10.6 m against 18.0 m allowed over 60.2 km). The 2026-09-04
feed's `S8-0-12` — 22.1 m over 129.5 km, the pattern that exposed this — sits at 69%.

**Rejected:** *Raising the flat number to 25 or 30 m.* It would unblock the build in one character
and keep the check's shape, but it makes the gate progressively more meaningless as lines get
shorter: 30 m on the 1.5 km `563-1-1` is 20000 ppm, which no real defect could ever exceed.

**Rejected:** *A pure parts-per-million gate.* The worst relative miss in the committed data is
410 ppm on the 11.0 km `562-0-3`, and a gate clearing that would allow 53 m on a 129.5 km line —
looser than the flat 20 m it replaced, on exactly the patterns where a real fault is most likely.
The observed misses do not scale cleanly with length (0-410 ppm, no tidy relationship), which is
why neither pure shape works and the two-term form does.

**Why:** the quantity being gated is cumulative corner-cutting, which grows with the number of
vertices simplification touches, while the failure it is meant to catch — a stop re-projected onto
the wrong pass of a self-proximate line — is a fixed hundreds-of-metres error independent of
length. A single absolute number cannot separate those two across a dataset spanning 1.5 km bus
loops and 129.5 km rail runs. Note the practical effect is not a loosening: at 11 km the new gate
is 8.2 m, 2.4 times **tighter** than the 20 m it replaces, and it only widens past the old value
beyond about 70 km.
