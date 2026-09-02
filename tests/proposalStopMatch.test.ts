import { describe, expect, it } from 'vitest'
import {
    applyNameCorrections,
    breclavStops,
    buildCandidates,
    isManesovaRow,
    matchStopName,
    normalizeTokens,
    resolveManesova,
} from '../scripts/proposal/stopMatch'
import type { Stop } from '../src/types/network'

const stops: Stop[] = [
    { id: 'breclav-namesti-tgm-kostel', name: 'Břeclav, náměstí TGM, kostel', lat: 0, lon: 0 },
    { id: 'breclav-namesti-tgm-mestsky-urad', name: 'Břeclav, náměstí TGM, městský úřad', lat: 0, lon: 0 },
    { id: 'breclav-postorna-hlavni', name: 'Břeclav, Poštorná, Hlavní', lat: 0, lon: 0 },
    { id: 'breclav-postorna-hlavni-na-konci', name: 'Břeclav, Poštorná, Hlavní na konci', lat: 0, lon: 0 },
    { id: 'breclav-postorna-kostel', name: 'Břeclav, Poštorná, kostel', lat: 0, lon: 0 },
    { id: 'breclav-stara-breclav-vinohradni', name: 'Břeclav, Stará Břeclav, Vinohradní', lat: 0, lon: 0 },
    { id: 'breclav-stara-breclav-manesova', name: 'Břeclav, Stará Břeclav, Mánesova', lat: 0, lon: 0 },
    { id: 'breclav-stara-breclav-kulturni-dum', name: 'Břeclav, Stará Břeclav, kulturní dům', lat: 0, lon: 0 },
    { id: 'breclav-stara-breclav-lidicka', name: 'Břeclav, Stará Břeclav, Lidická', lat: 0, lon: 0 },
    { id: 'breclav-nemocnice', name: 'Břeclav, nemocnice', lat: 0, lon: 0 },
    { id: 'hustopece-nemocnice', name: 'Hustopeče, nemocnice', lat: 0, lon: 0 },
]
const candidates = buildCandidates(breclavStops(stops))

describe('normalizeTokens', () => {
    it('strips diacritics, case and punctuation', () => {
        expect(normalizeTokens('Nám. TGM, mě. Ú.')).toEqual(['nam', 'tgm', 'me', 'u'])
    })

    it('collapses repeated whitespace', () => {
        expect(normalizeTokens('Stará Břeclav,  DK')).toEqual(['stara', 'breclav', 'dk'])
    })
})

describe('applyNameCorrections', () => {
    it('fixes the catalogued typos', () => {
        expect(applyNameCorrections('Necmonice')).toBe('Nemocnice')
        expect(applyNameCorrections('Mětský hřbitov')).toBe('Městský hřbitov')
        expect(applyNameCorrections('Poštoná, PKZ')).toBe('Poštorná, PKZ')
        expect(applyNameCorrections('Jana Moláka x')).toBe('Jana Moláka')
    })

    it('expands the DK abbreviation to kulturní dům', () => {
        expect(applyNameCorrections('Stará Břeclav,  DK')).toBe('Stará Břeclav,  kulturní dům')
    })
})

describe('breclavStops', () => {
    it('keeps only stops in the Břeclav municipality', () => {
        const ids = breclavStops(stops).map((s) => s.id)
        expect(ids).not.toContain('hustopece-nemocnice')
        expect(ids).toContain('breclav-nemocnice')
    })
})

describe('matchStopName', () => {
    it('matches an exact (post-normalisation) name', () => {
        expect(matchStopName('Nemocnice', candidates)).toEqual({ status: 'matched', id: 'breclav-nemocnice' })
    })

    it('matches an abbreviated multi-word name by trailing-anchored prefixes', () => {
        expect(matchStopName('nám.TGM kostel', candidates)).toEqual({
            status: 'matched',
            id: 'breclav-namesti-tgm-kostel',
        })
        expect(matchStopName('Nám. TGM, mě. Ú.', candidates)).toEqual({
            status: 'matched',
            id: 'breclav-namesti-tgm-mestsky-urad',
        })
    })

    it('matches a name with its local-area prefix dropped', () => {
        expect(matchStopName('Vinohradní', candidates)).toEqual({
            status: 'matched',
            id: 'breclav-stara-breclav-vinohradni',
        })
    })

    it('does not let a short name match a longer candidate that only shares a leading slice', () => {
        // "Poštorná,Hlavní" must resolve to the stop of that exact name, never to
        // "Poštorná, Hlavní na konci" — the two share only their first two words.
        expect(matchStopName('Poštorná,Hlavní', candidates)).toEqual({
            status: 'matched',
            id: 'breclav-postorna-hlavni',
        })
    })

    it('ignores a trailing "Výstup" (alighting) qualifier', () => {
        expect(matchStopName('Poštorná , kostel Výstup', candidates)).toEqual({
            status: 'matched',
            id: 'breclav-postorna-kostel',
        })
    })

    it('reports a genuinely new stop as unmatched, not invented', () => {
        expect(matchStopName('Jana Skácela/1. Máje Výstup', candidates)).toEqual({ status: 'unmatched' })
    })

    it('reports an empty or purely-punctuation name as unmatched', () => {
        expect(matchStopName('', candidates)).toEqual({ status: 'unmatched' })
    })
})

describe('isManesovaRow', () => {
    it('recognises the bare name (as line 566 writes it)', () => {
        expect(isManesovaRow('Mánesova')).toBe(true)
    })

    it('recognises the name with its area prefix (as line 569 writes it)', () => {
        // A real bug: checking for exact equality against "manesova" alone missed this form,
        // silently falling through to ordinary matching — which, since the existing pole is the
        // only "Mánesova" candidate the matcher knows about, resolved every row to it regardless
        // of which physical pole the row sequence actually called for.
        expect(isManesovaRow('Stará Břeclav,  Mánesova')).toBe(true)
    })

    it('does not mistake an unrelated name for it', () => {
        expect(isManesovaRow('Lidická')).toBe(false)
    })
})

describe('resolveManesova', () => {
    // Real occurrences from the workbook (see the task report) — line 566 and 569 shortcut
    // straight between Lidická and Mánesova, but line 565 visits every stop of the corridor
    // (Lidická - Skopalíkova - Vinohradní - Mánesova - kulturní dům - u parku - ...), so a
    // neighbour on *either* the town side or the far side must resolve correctly, not just the
    // two immediately adjacent to Mánesova.

    it('reuses the existing pole when the next neighbour is on the town side (566, line 1)', () => {
        expect(resolveManesova(undefined, 'breclav-stara-breclav-lidicka', 'new-pole')).toBe(
            'breclav-stara-breclav-manesova',
        )
    })

    it('uses the new pole when the next neighbour is on the far side (566, line 2)', () => {
        expect(resolveManesova(undefined, 'breclav-stara-breclav-kulturni-dum', 'new-pole')).toBe('new-pole')
    })

    it('reuses the existing pole for a town-side neighbour two stops further out (565, row 49: kulturní dům -> Mánesova -> Vinohradní)', () => {
        expect(
            resolveManesova('breclav-stara-breclav-kulturni-dum', 'breclav-stara-breclav-vinohradni', 'new-pole'),
        ).toBe('breclav-stara-breclav-manesova')
    })

    it('uses the new pole for a far-side neighbour two stops further out (565, row 17: Vinohradní -> Mánesova -> kulturní dům)', () => {
        expect(
            resolveManesova('breclav-stara-breclav-vinohradni', 'breclav-stara-breclav-kulturni-dum', 'new-pole'),
        ).toBe('new-pole')
    })

    it('falls back to the previous neighbour, sides swapped, when there is no next one', () => {
        // A row with no next stop but a previous one of "kulturní dům" arrived *from* the far
        // side — the same direction of travel as the existing pole's own (kulturní dům ->
        // Mánesova -> Lidická), so it reuses it, even though "kulturní dům" is the far-side stop
        // that means the *opposite* when it is the row's next neighbour instead.
        expect(resolveManesova('breclav-stara-breclav-kulturni-dum', undefined, 'new-pole')).toBe(
            'breclav-stara-breclav-manesova',
        )
        expect(resolveManesova('breclav-stara-breclav-lidicka', undefined, 'new-pole')).toBe('new-pole')
    })

    it('throws rather than guess when neither neighbour is a known stop on either side', () => {
        expect(() => resolveManesova('breclav-jana-palacha', 'breclav-gumotex', 'new-pole')).toThrow()
    })
})
