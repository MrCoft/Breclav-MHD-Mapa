# Open questions

Read before starting a task; revise when finishing one. Log questions here rather than guessing or silently picking.

## 1. There is no lint step, but the guidelines require one

`CLAUDE.md` says to run the project's full check — typecheck, lint and tests — before calling anything done. This project has typecheck (`tsc`) and tests (Vitest) but no linter, so "the full check" is currently two thirds of a check.

Adding ESLint with the TypeScript and React plugins is the obvious move, but it was not in the approved implementation plan and would introduce its own findings across code already written. **Decide:** add ESLint now as a conformance task, add it after the 17 planned tasks land, or leave typecheck plus tests as this project's definition of the full check.

## 2. What shape should the current-vs-proposed comparison take?

**Reopened 2026-09-02:** the proposed network now exists. The user supplied
`data/navrh_2026_new2.xlsx` and said a toggle is wanted after all.

What the file contains: a summary sheet comparing two variants, **Návrat** and **Prinz**, by
kilometres per line, with near-identical totals (2271 vs 2267.7) — so the two are alternative
networks at roughly the same operating cost. Then eight per-line sheets: 561, 562, 563, 565,
566, 567, 568, 569. Line **564 has no sheet**, and its Prinz kilometres are 0 while its Návrat
kilometres are 189/179 — which is why the working inference is that the eight sheets are the
**Prinz** variant, in which 564 is deleted.

Sheet shape: stops down the rows (with sequence number, name, and `odj.`/`příj.` markers, and
repeats where a route loops), trips across the columns, times as Excel day-fractions with a
few literal `HH:MM` strings mixed in, and `~` marking a stop a given trip does not serve.
Between 6 and 23 trips per line. The header row is labelled "Všední den neprázdninový" —
school-term weekday only, so the proposal has no weekend or holiday service.

**Blocking questions are in the section below.** The comparison UI cannot be designed until
they are answered, because they decide what is being compared.

Superseded context: the user was originally asked and answered "ignore this for now". The data format and `scenarios.json` already support more than one scenario; only the UI is missing.

The options previously put forward were: a toggle between scenarios, a synced side-by-side split map, or a single map with diff colouring (unchanged grey, removed red, added green). **Decide once the proposed network exists**, since its shape will make one of these obviously right. Until then the scenario switcher will have exactly one entry in it.

## 3. When does parallel-line offsetting become worth building?

Where many lines share one street — most of central Břeclav — the drawn routes overlap into a single stroke. Doing it properly needs segment-level deduplication across patterns and `line-offset` ranking, which is real work.

The line-browser highlight makes the map readable without it, so it is deferred. **But** if the argument for the proposed network turns out to be about corridors and service density rather than about where individual lines run, this moves up the priority list sharply. **Decide when the proposal's argument is known.**

## 4. Should this project be registered in Ai-Config?

`CLAUDE.md` here was composed from `Ai-Config/Templates/_shared` + `Templates/React-Web-App`, but no corresponding entry was added under `Ai-Config/docs/projects/`. Every other project of the user's appears to have one, carrying front-matter with `path`, `slug`, `family`, `stack`, `template`, `status` and `last_synced`.

Not done unilaterally, because writing into the user's config repo is outside this project. **Decide:** register it so the guidelines stay in sync automatically, or keep this copy standalone.

## 5. Do the measured feed counts belong in the spec?

The design spec quotes measured figures from the real feed (routes, trips, `stop_times` rows, stops before and after parent-station collapse, pattern count). `CLAUDE.md` says not to state counts in documentation that nothing verifies.

Partially resolved: the converter asserts the route count against a configured band, and `npm run build:network` prints all of the figures, so the spec now names that command. **Still open:** whether the remaining hard-coded numbers in the spec should be replaced by that command reference entirely, at the cost of losing the evidence that justified several design decisions.

## 6. Which variant is in the spreadsheet? — RESOLVED 2026-09-02

`data/jizdni_rady_2026.pdf` settles it: the document is titled "Prinz návrh jízdních řádů
2026" and is an attachment to a petition. The eight sheets are Prinz's proposal. Návrat is the
alternative it is costed against and has no timetables anywhere in the supplied files. See
decision 18.

## 7. Should the comparison be restricted to city lines?

The current scenario covers all 20 routes touching Břeclav, including regional buses and the
trains out to Brno, Znojmo and Staré Město. The proposal covers only city lines 561–569.
Toggling between them as they stand would compare a regional network against a city one, and
every regional line would appear "deleted" in the proposal.

**Answered:** comparison mode filters to city lines 561–569; the standalone map keeps
everything. See decision 19.

**But a wrinkle remains open.** The proposal's own description changes two regional lines:
"564 zrušena a nahrazena 574" (564 cancelled, replaced by regional line 574) and "571
zastavuje na všech nácestných zastávkách" (571 to stop at all intermediate stops). A strict
561–569 filter hides both, so the comparison would show line 564 simply vanishing with no
indication that 574 is meant to absorb it — which misrepresents the proposal.

**Decide:** admit 571 and 574 into comparison mode as a named exception, annotate 564's
removal with a pointer to 574, or accept the omission and explain it in the UI.

## 8. Is a school-term-weekday-only comparison acceptable? — RESOLVED 2026-09-02

Yes. Comparison mode locks to a school-term weekday; the standalone map keeps all day types.
See decision 19.

## 9. Extracting timetables from the PDFs

`data/jr_260614/` holds the nine official PDF timetables for lines 561–569, valid from
2026-06-14. They are **not** a better source than GTFS for the current network: GTFS is already
structured, already covers all 20 routes including trains, and the feed downloaded on
2026-08-28 is newer than these PDFs. PDF table extraction would be lossy and cover only the
city lines.

They are still worth keeping, for two reasons: they are the authoritative published document,
so they can cross-check the GTFS-derived departure boards for lines 561–569; and they use the
same line and stop naming as the proposal spreadsheet, which helps when mapping proposed stop
names onto GTFS parent stations. **Decide** whether a cross-check task is worth writing.

## 10. Which proposed stops do not exist yet?

The proposal asks for stops that are not in the current network: a bidirectional stop on Na
Zahradách, a Mánesova stop in the opposite direction, and an alighting stop on J. Skácela. It
also moves Průmyslová škola and proposes cutting Domov důchodců.

The importer must therefore create stops that have no GTFS parent station and no coordinates,
and the map has to place them. **Decide:** hand-place them in a small overrides file, or omit
them and accept that those patterns will be geometrically wrong.
