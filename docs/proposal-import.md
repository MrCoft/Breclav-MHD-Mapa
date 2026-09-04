# Importing the proposed network

How `scripts/build-proposal.ts` and `scripts/proposal/*.ts` turn the petition's spreadsheet into
`public/data/proposed/`. Several source comments in that code point at "the task report" for the
full reasoning — those reports live under `.superpowers/`, which is gitignored, so a maintainer
auditing how a citizens' petition became map data would find nothing there. This document is that
reasoning, in the repo where a reader can actually reach it.

For the *why* behind treating this data as one proposal, which variant it is, and what is and
isn't in scope, see `docs/decisions.md` #18–#20. This document is the *how*.

## Source documents

- The workbook named by `config/proposal.json`'s `workbook` field — today
  `data/navrh_2026_new2.xlsx`, but the path is config rather than a constant in the converter
  (decision 35), so a new version of the proposal is a config edit and one `pnpm run build:proposal`.
  Cell-addressed structured data: one sheet per city line, each named exactly after the line
  (561, 562, 563, 565, 566, 567, 568, 569 — line 564 has no sheet, because the proposal cancels
  it), with the sheets to import likewise listed in `config/proposal.json`. The README's "Updating
  the proposal spreadsheet" section records which parts of a new workbook the importer absorbs on
  its own and which still need code.
- `data/jizdni_rady_2026.pdf` — narrative and cross-check only, never imported directly. Text
  recovered from a PDF by whitespace alignment is fragile; the spreadsheet is not. The PDF
  supplies things the spreadsheet lacks: which sheet is which direction, per-trip kilometres, the
  prose description of what's changing and why, and the direction labels ("opačný směr") used to
  confirm `parseSections`' assumption below.
- `data/jr_260614/` — the current network's own official PDF timetables for lines 561–569, valid
  from 2026-06-14. Not used as an import source (GTFS is newer and more complete — decision 20's
  reasoning applies here too); useful only for cross-checking stop and line names against the
  proposal's own naming, since both share it.

## Workbook shape (`scripts/proposal/sheet.ts`)

Each line sheet stacks **two** independent sections, not one: a row with `"Tč"` in column A
starts each, and both sections reuse the same Excel columns (D, E, F, …) for their own trip
numbering. `findHeaderRows` finds every such row; `parseSections` slices the sheet between
consecutive header rows. The first section is always the line's outbound direction (`0`), the
second always its return (`1`) — confirmed by row order (every stop sequence reverses between the
two) and, where present, by the PDF's own "opačný směr" label.

Within a section, each row is either a real stop or one of two things that look like one but
aren't, both of which `parseSections` filters out:

- A **direction-label row** ("návrh k projednání") — never carries a sequence number in column A,
  so it's dropped by the "column A must be populated" check alone.
- A **distance-total row**, labelled `"km"` on most sheets but garbled to `"X+X50"` on one (562's
  return section) — so it can't be filtered by label text alone. `looksLikeSummaryRow` detects it
  structurally instead: a real stop's time cells are either `HH:MM` text or an Excel day-fraction
  (always < 1, a fraction *of one day*), while a distance total's cells are km figures, routinely
  ≥ 1. A row counts as a summary only once more than half its populated cells clear that bound —
  a single stray value near the boundary (a stop a few minutes past midnight rounds to just over
  0 either way) isn't enough on its own.

## Time parsing (`scripts/proposal/time.ts`)

`cellToMinutes` handles three cell shapes: `~` (`SKIPPED_MARKER`, a trip that doesn't serve this
stop), blank/whitespace, and an actual time — either a literal `"H:MM"` string or an Excel
day-fraction float, rounded to the nearest minute (the source's own arithmetic leaves long
floating tails, e.g. `0.21875` next to a neighbour stored as `...99999999983`).

`MAX_PLAUSIBLE_MINUTES` (48 hours) exists because of one specific found-by-hand defect: three
trip columns on line 566's return section hold the literal text `"562"` — very likely a stray
reference to another line's number — where an arrival time belongs. `Number('562')` is not `NaN`,
so without this bound it would parse as 809,280 minutes past midnight and silently corrupt that
trip. Anything past the bound is treated as not served, the same as a blank cell, rather than
guessed at.

## Stop name matching (`scripts/proposal/stopMatch.ts`)

The proposal never carries a municipality prefix and routinely abbreviates or drops the
local-area name ("Poštorná,", "Stará Břeclav,"), so matching a proposal row like `"nám.TGM
kostel"` to the feed's `"Břeclav, náměstí TGM, kostel"` can't be an exact-string lookup.
`matchStopName` instead requires the row's normalised tokens to line up, **in order, anchored at
the end**, with the trailing tokens of a candidate stop. Anchoring at the end (never the start or
an interior slice) is what tells a real match (`"Vinohradní"` → `"…, Vinohradní"`) apart from a
false one (`"Poštorná,Hlavní"` must not also match `"…, Hlavní na konci"`, which shares only a
leading slice).

The candidate pool is Břeclav's own stops only (`breclavStops`), not the whole region — a bare
`"Nemocnice"` row would otherwise suffix-match Hustopeče's, Valtice's *and* Břeclav's own
"nemocnice" stop, all three sharing that final token, since the proposal is entirely an
intra-town network.

**Typo corrections** (`NAME_CORRECTIONS`), found by hand while cataloguing every distinct stop
name the workbook uses: `Necmonice` → `Nemocnice`, `Mětský` → `Městský`, `Poštoná` → `Poštorná`,
`Moláka x` → `Moláka`, plus one genuine abbreviation, `DK` → `kulturní dům` (used only for the
Stará Břeclav stop of that name). Each pattern is a whole-word match specific enough that it
can't touch an unrelated name — built with a `\p{L}`/`\p{N}` word-boundary regex rather than `\b`,
since JavaScript's `\b` only treats ASCII letters as word characters and fails silently on a word
starting or ending in a diacritic, exactly the words being corrected here.

### The Mánesova disambiguation

The stop "Mánesova" is used today only by line 565's return direction (one physical pole). The
proposal's PDF (page 2) adds a second pole for the opposite direction, but every row naming it —
regardless of which pole it means — is spelled identically, so name matching alone can't tell them
apart.

`resolveManesova` tells them apart by direction of travel instead, using line 565's own sheet
(the one line that visits every stop on this street, not just the ones 566 and 569 shortcut past)
to lay out the corridor as:

```
Sovadinova - Lidická - Skopalíkova - Vinohradní - Mánesova - kulturní dům - u parku - …
```

The existing pole's context (`kulturní dům → Mánesova → Lidická`) runs *toward* Sovadinova (the
"town side"). A Mánesova row whose next stop is on the town side reuses the existing pole; a row
whose next stop is on the far side (`kulturní dům` itself, or beyond it) needs the new pole. For a
row with no next stop (end of its section), the previous stop still tells the direction, with the
two sides swapped — arriving *from* the far side is the same direction of travel as continuing
*to* the town side. `resolveManesova` throws if neither neighbour is a known stop on either side,
rather than guessing, because that would mean the rule above no longer holds for some row this
wasn't checked against.

This two-pass resolution (`resolveSectionStops` in `build-proposal.ts`) is why Mánesova rows are
deferred to a second pass rather than resolved inline with everything else: a row's own neighbours
have to be resolved first.

## Stops that don't exist yet (`data/proposed-stops.json`)

Three stops the proposal asks for have no GTFS parent station and no coordinates (decision 19's
"known wrinkle", open question 10, resolved in open question 15): a bidirectional stop on Na
Zahradách, the new Mánesova pole described above, and an alighting-only stop on J. Skácela. Each
is hand-placed from the PDF's description against OpenStreetMap and recorded in
`data/proposed-stops.json` with an explanatory `note`, so the placement is auditable rather than a
silent guess. `build-proposal.ts` checks all three expected override ids are present before doing
anything else, and folds them into the same candidate pool `matchStopName` searches — except the
new Mánesova pole, deliberately excluded from that generic pool (its name is identical to the
existing stop's, so it can only ever be reached through `resolveManesova`'s explicit rule, never
through ordinary fuzzy matching, which would otherwise resolve every Mánesova row to whichever
pole happens to sort first).

## Lines carried over unchanged (`meta.inheritedLines`)

The proposal's own description changes two lines the eight per-line sheets don't cover: it cancels
564 in favour of 574, and has 571 stop at every intermediate stop — but supplies no timetable for
either change (decision 19's "known wrinkle"). `build-proposal.ts` carries both over from the
current scenario exactly as they are (same patterns, trips, geometry) rather than inventing a
timetable no source states, and records the reason in `meta.inheritedLines.note`. `LineBrowser`
surfaces that note and marks both lines with a "Beze změny" badge, so they read as what they are —
today's network, not the proposal's — rather than being indistinguishable from the eight lines
the petition actually redesigns.

## Deriving dates from the current scenario

The workbook states only a day mask ("Všední den neprázdninový" — school-term weekday), never a
date range or a holiday calendar. `build-proposal.ts` derives both from the current scenario's own
core Monday–Friday service (`coreWeekdayService`: the weekday-masked service with the widest
`from`..`to` span, rather than an assumed service id) — its date range, and its own `removed`
dates (the Czech public holidays it excludes even though they fall on a weekday). The proposal's
`feedDate` and `meta.derivedFrom` likewise come from `public/data/current/meta.json`, so a stale
derivation (this proposal built against a `current` that has since been regenerated) can be
spotted by diffing the two `meta.json` files instead of assumed to always match.
