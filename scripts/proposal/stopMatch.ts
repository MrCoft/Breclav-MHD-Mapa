import { municipalityOf } from '../gtfs/scope'
import type { Stop } from '../../src/types/network'

/**
 * Matches a proposal stop name (e.g. `"nám.TGM kostel"`) to an existing stop
 * (`"Břeclav, náměstí TGM, kostel"`). The proposal never carries a municipality prefix and
 * routinely abbreviates or drops the local-area name ("Poštorná,", "Stará Břeclav,"), so this
 * cannot be an exact-string lookup — see `docs/proposal-import.md` for the catalogue of real
 * spreadsheet spellings this was built and checked against.
 */

// JavaScript's `\b` only ever treats ASCII letters as "word" characters, so it fails silently
// on a word starting or ending in a diacritic — exactly the words this needs to match ("Mětský",
// "Poštoná"). This builds an equivalent boundary out of `\p{L}`/`\p{N}` instead.
function wholeWordPattern(word: string): RegExp {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu')
}

/**
 * Typos in the source workbook, found by hand while cataloguing every distinct stop name it
 * uses (see `docs/proposal-import.md`), plus one genuine abbreviation ("DK" for "kulturní dům", used only
 * for the Stará Břeclav stop of that name). Each pattern is specific enough that it cannot touch
 * an unrelated name.
 */
const NAME_CORRECTIONS: [RegExp, string][] = [
    [wholeWordPattern('Necmonice'), 'Nemocnice'],
    [wholeWordPattern('Mětský'), 'Městský'],
    [wholeWordPattern('Poštoná'), 'Poštorná'],
    [wholeWordPattern('Moláka x'), 'Moláka'],
    [wholeWordPattern('DK'), 'kulturní dům'],
]

export function applyNameCorrections(raw: string): string {
    return NAME_CORRECTIONS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), raw)
}

// Same approach as `slugify` in scripts/gtfs/scope.ts, for consistency.
function stripDiacritics(text: string): string {
    return text.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/** Case/diacritics/punctuation/whitespace-insensitive tokens, e.g. `"Nám. TGM, kostel"` -> `["nam","tgm","kostel"]`. */
export function normalizeTokens(raw: string): string[] {
    return stripDiacritics(raw)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((token) => token.length > 0)
}

/** True when the shorter token is a prefix of the longer one — how the proposal's abbreviations
 *  ("nám." for "náměstí", "N." for "Nová", "mě. Ú." for "městský úřad") line up with the feed's
 *  full names. */
function tokensCompatible(a: string, b: string): boolean {
    if (a === b) {
        return true
    }
    const shorter = a.length <= b.length ? a : b
    const longer = a.length <= b.length ? b : a
    return shorter.length > 0 && longer.startsWith(shorter)
}

export interface StopCandidate {
    id: string
    /** Normalised tokens of the candidate's own name, with a leading "breclav" token dropped. */
    tokens: string[]
}

export function buildCandidates(stops: Pick<Stop, 'id' | 'name'>[]): StopCandidate[] {
    return stops.map((stop) => {
        const tokens = normalizeTokens(stop.name)
        return { id: stop.id, tokens: tokens[0] === 'breclav' ? tokens.slice(1) : tokens }
    })
}

/**
 * Only Břeclav's own stops are matched against: the proposal is entirely an intra-town network,
 * and matching against the wider region's stops as well produces real ambiguity — e.g. a bare
 * "Nemocnice" row would otherwise suffix-match Hustopeče's, Valtice's *and* Břeclav's own
 * "nemocnice" stop, all three sharing that final token.
 */
export function breclavStops(stops: Stop[]): Stop[] {
    return stops.filter((stop) => municipalityOf(stop.name) === 'Břeclav')
}

export type StopMatch =
    { status: 'matched'; id: string } | { status: 'unmatched' } | { status: 'ambiguous'; ids: string[] }

/**
 * Matches `raw` against `candidates` by requiring its tokens to line up, in order, with the
 * *trailing* tokens of a candidate — never a leading or interior slice. A proposal name is
 * always either the candidate's full name or its name with a leading area qualifier dropped
 * ("Poštorná,", "Stará Břeclav,", the municipality); it is never missing a *trailing* word.
 * Anchoring only at the end is what tells a real match ("Vinohradní" -> ".., Vinohradní") apart
 * from a false one ("Poštorná,Hlavní" must not also match ".., Hlavní na konci", which shares
 * only a leading slice).
 */
export function matchStopName(raw: string, candidates: StopCandidate[]): StopMatch {
    const corrected = applyNameCorrections(raw)
    let tokens = normalizeTokens(corrected)
    // "Výstup" ("alighting") is a rider-facing annotation on a handful of rows, not part of the
    // stop's own name — the stop it annotates is otherwise named identically to its normal self.
    if (tokens.length > 1 && tokens[tokens.length - 1] === 'vystup') {
        tokens = tokens.slice(0, -1)
    }
    if (tokens.length === 0) {
        return { status: 'unmatched' }
    }

    const matches = new Set<string>()
    for (const candidate of candidates) {
        const offset = candidate.tokens.length - tokens.length
        if (offset < 0) {
            continue
        }
        let ok = true
        for (let i = 0; i < tokens.length; i += 1) {
            if (!tokensCompatible(tokens[i]!, candidate.tokens[offset + i]!)) {
                ok = false
                break
            }
        }
        if (ok) {
            matches.add(candidate.id)
        }
    }

    if (matches.size === 0) {
        return { status: 'unmatched' }
    }
    if (matches.size === 1) {
        return { status: 'matched', id: [...matches][0]! }
    }
    return { status: 'ambiguous', ids: [...matches].sort() }
}

/**
 * The stop "Mánesova" is used, in the current network, only by line 565's return direction
 * (kulturní dům -> Mánesova -> Lidická) — its one physical pole sits on that side of the street.
 * The proposal's PDF (page 2: "zřízení zastávky Mánesova také v opačném směru") adds a second
 * pole for the opposite direction, but every row that names it is spelled identically
 * "Mánesova" (or, on line 569, "Stará Břeclav,  Mánesova"), so the two poles cannot be told apart
 * by name alone.
 *
 * They can be told apart by which side of Mánesova the row sequence continues to. Line 565 (the
 * one line whose sheet visits every stop along this street, not just the ones 566 and 569
 * shortcut past) lays out the full corridor as:
 *
 *     Sovadinova - Lidická - Skopalíkova - Vinohradní - Mánesova - kulturní dům - u parku - ...
 *
 * The existing pole's own context (kulturní dům -> Mánesova -> Lidická) runs *toward* Sovadinova;
 * a row whose *next* stop is any other one on that same (town) side — Lidická, Skopalíkova or
 * Vinohradní — continues in that same direction and reuses it. A row whose next stop is on the
 * far side — kulturní dům itself, or anything beyond it (u parku, J. Moláka, křižovatka Ladná) —
 * runs the opposite way and needs the new pole. "Next" and "previous" are not interchangeable
 * here — arriving *from* the far side (previous = kulturní dům) means the same direction of
 * travel as continuing *to* the town side, not the same side as it — so the previous neighbour,
 * used only when a row has no next one, is checked with the two sides swapped.
 */
export const MANESOVA_EXISTING_ID = 'breclav-stara-breclav-manesova'

const MANESOVA_TOWN_SIDE = new Set([
    'breclav-sovadinova',
    'breclav-stara-breclav-lidicka',
    'breclav-stara-breclav-skopalikova',
    'breclav-stara-breclav-vinohradni',
])
const MANESOVA_FAR_SIDE = new Set([
    'breclav-stara-breclav-kulturni-dum',
    'breclav-stara-breclav-u-parku',
    'breclav-stara-breclav-j-molaka',
    'breclav-stara-breclav-krizovatka-ladna',
])

/**
 * True for a stop row that names the ambiguous "Mánesova" stop — see `resolveManesova`.
 * Checked by trailing token, not exact equality: line 566 writes the bare "Mánesova", but line
 * 569 writes it with its area prefix, "Stará Břeclav,  Mánesova" — both must be caught, or a row
 * silently falls through to ordinary matching, which (since the existing pole is the only
 * "Mánesova" candidate in the pool) always resolves it to the existing pole even where the row
 * sequence calls for the new one.
 */
export function isManesovaRow(rawName: string): boolean {
    const tokens = normalizeTokens(applyNameCorrections(rawName))
    return tokens.at(-1) === 'manesova'
}

export function resolveManesova(
    previousResolvedId: string | undefined,
    nextResolvedId: string | undefined,
    newPoleId: string,
): string {
    if (nextResolvedId !== undefined) {
        if (MANESOVA_TOWN_SIDE.has(nextResolvedId)) {
            return MANESOVA_EXISTING_ID
        }
        if (MANESOVA_FAR_SIDE.has(nextResolvedId)) {
            return newPoleId
        }
    }
    // No next stop (a row at the very end of its section) — the previous one still tells the
    // direction of travel, just with the two sides swapped: arriving *from* the far side is the
    // same direction as continuing *to* the town side.
    if (previousResolvedId !== undefined) {
        if (MANESOVA_FAR_SIDE.has(previousResolvedId)) {
            return MANESOVA_EXISTING_ID
        }
        if (MANESOVA_TOWN_SIDE.has(previousResolvedId)) {
            return newPoleId
        }
    }
    throw new Error(
        `resolveManesova: neither neighbour (${previousResolvedId ?? '(none)'}, ${nextResolvedId ?? '(none)'}) is a ` +
            'known stop on either side of Mánesova — cannot tell which of its two poles this row means; the rule ' +
            'this function encodes no longer holds',
    )
}
