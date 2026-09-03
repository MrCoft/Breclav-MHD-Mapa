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

## 3. `scripts/` is typechecked under the app tsconfig's DOM lib, via the tests that import it

**Found:** 2026-09-02, while implementing the GTFS reader (Task 6).
**Where:** `tsconfig.app.json` / `tsconfig.node.json` — the program boundaries, surfaced at `scripts/gtfs/read.ts` (`downloadFeed`).
**Problem:** `tests/` is compiled under `tsconfig.app.json`, which includes the DOM lib. A test
importing from `scripts/` transitively pulls that Node-side file into the DOM-flavoured program,
so `fetch`'s `res.body` resolves to DOM's `ReadableStream` rather than Node's. DOM's version
lacks the async-iterator members `node:stream/promises`' `pipeline()` requires, and the build
fails on code that is correct for the runtime it actually executes in.
**Impact:** Worked around with a type-only cast, which has no runtime effect, so nothing is
broken today. The real problem is structural: Node-side scripts are being typechecked against
browser lib definitions, so this will recur for any script touching a Node API that shares a
name with a DOM one. The fix is to give `scripts/` and the tests that import it their own
program under `tsconfig.node.json` rather than casting at each collision.

## 4. A paused deep link (`?d=`/`?t=`) shows no vehicles at all

**Found:** 2026-09-02, while browser-verifying Task 25 (the scenario toggle). Reproduces
identically on the pre-Task-25 code (confirmed by reverting `src/map/MapView.tsx` to HEAD and
retesting), so this is not caused by that task — it is a pre-existing defect in the Task 21/22
clock/vehicle wiring, only noticed now because Task 25's verification exercised deep links more
than before.
**Where:** `src/map/MapView.tsx:550` (the clock subscription: `return clock.subscribe((clockState) => { const source = instance.getSource('vehicles'); if (!source) return; ... })`), racing against `src/map/MapView.tsx:505-519` (`install()`, deferred to `instance.once('load', install)` when `!instance.isStyleLoaded()`); `src/state/clock.ts:142-144` (`subscribe` calls `listener(state)` synchronously, exactly once, at registration time).
**Problem:** `clock.subscribe` invokes its listener immediately on registration, and — while
playing — again on every animation frame, which is what masks this: if the first, immediate call
lands before the map's style has finished loading (so `installLayers` hasn't run yet and
`getSource('vehicles')` is still `undefined`), that first call is silently dropped, but the next
frame's call retries and succeeds within a fraction of a second. A paused clock (`playing:
false`, e.g. from opening a `?d=&t=` link, or `ClockControls`'s "Odkaz na čas" button) never
schedules another frame, so if that one inaugural call loses the race against the style's
asynchronous load — which it did in every trial — no `setData` call for the `vehicles` source
ever happens again, and the map shows route lines with zero vehicles on them indefinitely.
**Impact:** Confirmed reproducible via `querySourceFeatures('vehicles')` immediately after a
production build: 0 features after loading `?d=2026-09-02&t=07:30`, `?d=2026-09-02&t=20:10` and
`?s=proposed&d=2026-09-02&t=07:30` (all paused), against 31-40 features loading the same
scenario/time with no `?t=` (autoplaying). Reproduces for both scenarios, so it is unrelated to
which network is loaded. Every shared "moment" link — the one feature `?d=`/`?t=` and "Odkaz na
čas" exist for — opens looking like an empty, unstaffed network. The fix is most likely to make
the vehicle listener retry once the map's own `load` (or the `styledata`-driven `install`)
fires, rather than relying on a single immediate call that assumes the source already exists.

**Resolved:** `eaffd3e` (`fix: populate the vehicles source at layer-install time, not just via
the clock`). `installLayers` now seeds the `vehicles` source with `clock.getState()` at the
moment it creates the source, instead of starting it empty and waiting on the clock
subscription's own `setData`. Seeding happens synchronously inside `install()`, so correctness no
longer depends on which of style-load or clock-subscription-registration happens first — both
orderings work by construction. Verified against a production build: the same paused deep links
listed above now show 40-74 vehicle features instead of 0; the playing case and a scenario switch
while paused both still populate vehicles too. `e2e/pausedDeepLink.spec.ts` covers this, and
fails against the pre-fix code.

## 5. A tail of bus patterns sits ~200 m from its projected point on the simplified line

**Found:** 2026-09-02, while gating `maxOffMetres` per mode (finding I7 of the whole-branch
review). Recorded afterwards by the controller: the task's own report claimed this entry had been
written, and it had not — the re-review caught the discrepancy.
**Where:** `scripts/build-network.ts` (`MAX_OFF_BUS_METRES`), against the geometry of patterns on
lines 571, 564, 562 and 572.
**Problem:** most bus patterns project onto their simplified line within a handful of metres, but a
small tail reaches **208.2 m** in the worst committed case. The per-mode gate was therefore set at
250 m — reusing `matchPatternGeometry`'s own long-standing `maxSnapMetres` default rather than
inventing a number, but leaving only about 20% headroom above the measured worst case.
**Impact:** none today; the build passes. Two latent risks. A stop relocation or a routine
OpenStreetMap edit could nudge one of those known 200 m-plus patterns past 250 m and fail the build
with no actual defect present. And the gate's rationale borrows rail's reasoning about how far a
wrong window match lands, which was sized against a 115 km rail line; a genuinely wrong bus match on
a short urban route might land inside the 200–300 m band and pass. Worth investigating **why** those
particular patterns sit so far out — that is the question nobody has asked yet — rather than
adjusting the threshold if it ever trips.

## 6. The GTFS converter reads only `departure_time`, so every layover becomes travel time

**Found:** 2026-09-03, sanity-checking vehicle speeds after the user reported buses moving
incredibly slowly on the map.
**Where:** `scripts/build-network.ts:292` — `parseGtfsTime(r.departure_time)` is the only time
read out of `stop_times.txt`. `GtfsStopTimeRow` declares `arrival_time` (`scripts/gtfs/scope.ts:34`)
but nothing reads it, and `TripShape.times` (`scripts/gtfs/convert.ts:12-13`) is documented as
departure minutes, so `buildPatternsAndTrips` turns departure-to-departure into the offsets the
client interpolates across.
**Problem:** a segment's scheduled run time is `arrival[i+1] - departure[i]`, not
`departure[i+1] - departure[i]`. The difference is the dwell at the arriving stop, which this feed
carries in bulk: of 23273 in-scope `stop_times` rows, **3761 (16.2%) have
`departure_time > arrival_time`, totalling 43049 minutes**. 1024 of those sit at a trip's *last*
stop, where the value is a terminus layover, not a wait — trip 6387 on line 572 arrives at Hodonín
bus station at 7:42 and its `departure_time` there is 13:18, so the shipped offsets stretch the
final 1074 m leg to 338 minutes. The worst single case in the feed is 792 minutes.
`src/domain/vehicles.ts` then does exactly what it is told: subtracts a 25-second dwell and spreads
the remaining hours evenly across a kilometre of polyline.
**Impact:** the visible symptom the user reported. Measured against the committed
`public/data/current`, per-trip segments joined to their shipped `stopDistances`: **133 segments run
under 5 km/h as shipped, 1 under the arrival-corrected model; 232 under 10 km/h as shipped, 45
corrected.** On a Thursday, the share of on-screen vehicles crawling below 5 km/h is 18% at 06:00,
42% at 10:00, 20% at 13:00 and 29% at 20:00, with a worst live segment of 812 minutes. A second
consequence is in `departuresAt`: the last stop of such a trip advertises the layover departure
(13:18) rather than the arrival (7:42) as a departure time. The proposed scenario inherits lines
571 and 574 straight from this build, so its own slowest segments (574-1-5 at 0.7 km/h, 571-0-3 at
0.8 km/h) come from here too, not from the workbook. The fix needs a decision this entry does not
make: whether `Trip`/`Pattern` grow a second offsets vector (arrival alongside departure, so the
vehicle arrives on time and then visibly waits), or whether the converter simply uses
`arrival_time` for every stop after the first and drops the dwell.

## 7. The proposal importer ignores the workbook's `příj.`/`odj.` markers, so the bus station is imported twice

**Found:** 2026-09-03, during the same speed sanity check — this is what produces the
proposed scenario's 0 m segments.
**Where:** `scripts/proposal/sheet.ts:23,133` parses column C into `StopRow.marker`; nothing in
`scripts/build-proposal.ts` reads it, and `buildShapesForSection` (`:149`) pushes every stop row as
its own visit.
**Problem:** the workbook writes a mid-route timing point as two rows — `příj.` (arrival) and
`odj.` (departure) — for the same physical stop. Six of the eight city lines do this at
"Autobusové nádraží" in both directions (561, 566, 567, 568, 569 have a consecutive duplicate
pair; run `parseSections` over the workbook to see them). Imported as two stops, the pair becomes a
0-metre segment spanning the 1-4 minute layover.
**Impact:** milder than entry 6 and arguably right on the map — the vehicle parks at the station
for the layover, which is what actually happens. But `pattern.stops` carries the station twice, so
`index.patternsByStop` yields two positions for it and `departuresAt` lists both the arrival and
the departure of the same trip as two separate departures on that stop's panel. It also makes the
proposed scenario's stop counts per pattern one higher than the route really has. The two entries
share a fix shape: whatever represents "arrive, wait, depart" for the GTFS side should represent it
here too, rather than each importer inventing its own.
