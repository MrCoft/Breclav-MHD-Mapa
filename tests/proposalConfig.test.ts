import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadProposalConfig, workbookFromArgv } from '../scripts/proposal/config'
import { MANESOVA_EXISTING_ID } from '../scripts/proposal/stopMatch'
import type { ProposalConfig } from '../scripts/proposal/config'

describe('the committed config/proposal.json', () => {
    const config = loadProposalConfig()

    it('names a workbook and a stop-override file that are actually in the repo', () => {
        expect(existsSync(config.workbook)).toBe(true)
        expect(existsSync(config.stopOverrides)).toBe(true)
    })

    it('requires only override stops that file actually defines', () => {
        const overrides = JSON.parse(readFileSync(config.stopOverrides, 'utf8')) as { id: string }[]
        const defined = new Set(overrides.map((o) => o.id))
        expect(config.requiredStopOverrides.filter((id) => !defined.has(id))).toEqual([])
    })

    it('gives the proposal’s second Mánesova pole an id of its own', () => {
        // The two poles share a name, so `resolveManesova` can only tell them apart by id — one
        // config typo away from silently resolving every Mánesova row to the pole that exists today.
        expect(config.manesovaNewPoleId).not.toBe(MANESOVA_EXISTING_ID)
    })
})

const VALID: ProposalConfig = {
    workbook: 'data/navrh_2026_new2.xlsx',
    stopOverrides: 'data/proposed-stops.json',
    cityLines: ['561', '562'],
    inheritedLines: ['571'],
    serviceId: 'vsedni-den',
    longNames: { '561': 'Sem a zpět', '562': 'Tam a zpět' },
    requiredStopOverrides: ['breclav-na-zahradach', 'breclav-stara-breclav-manesova-2'],
    manesovaNewPoleId: 'breclav-stara-breclav-manesova-2',
}

function configPath(changes: Partial<ProposalConfig>): string {
    const dir = mkdtempSync(join(tmpdir(), 'proposal-config-'))
    const path = join(dir, 'proposal.json')
    writeFileSync(path, JSON.stringify({ ...VALID, ...changes }), 'utf8')
    return path
}

describe('loadProposalConfig', () => {
    it('accepts the fixture every rule below mutates', () => {
        // The arrange step: each test below changes one field of this fixture, so a fixture that
        // was already invalid would make all of them pass without testing their own rule.
        expect(loadProposalConfig(configPath({}))).toEqual(VALID)
    })

    it('rejects a city line with no long name, naming the line', () => {
        const path = configPath({ cityLines: ['561', '562', '563'] })
        expect(() => loadProposalConfig(path)).toThrow(/cityLines has line 563, but longNames/)
    })

    it('rejects a line that is both a city line and an inherited one, naming the line', () => {
        const path = configPath({ inheritedLines: ['571', '562'] })
        expect(() => loadProposalConfig(path)).toThrow(/line 562 is in both cityLines and inheritedLines/)
    })

    it('rejects an empty list, naming the field', () => {
        expect(() => loadProposalConfig(configPath({ cityLines: [] }))).toThrow(/cityLines is empty/)
        expect(() => loadProposalConfig(configPath({ inheritedLines: [] }))).toThrow(/inheritedLines is empty/)
        expect(() => loadProposalConfig(configPath({ requiredStopOverrides: [] }))).toThrow(
            /requiredStopOverrides is empty/,
        )
    })

    it('rejects a Mánesova pole the build would not check for, naming it', () => {
        const path = configPath({ manesovaNewPoleId: 'breclav-manesova-typo' })
        expect(() => loadProposalConfig(path)).toThrow(
            /manesovaNewPoleId breclav-manesova-typo is not one of requiredStopOverrides/,
        )
    })

    it('reports every problem at once, rather than only the first', () => {
        // Both patterns have to match the same single thrown message, so a loader that stopped at
        // the first problem would fail one of them.
        const path = configPath({ cityLines: ['561', '563'], inheritedLines: ['563'] })
        expect(() => loadProposalConfig(path)).toThrow(/longNames has no name for it/)
        expect(() => loadProposalConfig(path)).toThrow(/in both cityLines and inheritedLines/)
    })
})

describe('workbookFromArgv', () => {
    it('leaves the configured workbook alone when the flag is absent', () => {
        expect(workbookFromArgv(['node', 'scripts/build-proposal.ts'])).toBeUndefined()
    })

    it('takes the path that follows the flag', () => {
        expect(workbookFromArgv(['node', 'x.ts', '--workbook', VALID.workbook])).toBe(VALID.workbook)
    })

    it('refuses a flag with no path at all', () => {
        expect(() => workbookFromArgv(['node', 'x.ts', '--workbook'])).toThrow(/--workbook needs a path/)
    })

    it('refuses to swallow the next flag as a path', () => {
        expect(() => workbookFromArgv(['node', 'x.ts', '--workbook', '--refresh-osm'])).toThrow(
            /--workbook needs a path/,
        )
    })

    it('refuses a path that does not exist, rather than failing later inside the zip reader', () => {
        expect(() => workbookFromArgv(['node', 'x.ts', '--workbook', 'data/nope.xlsx'])).toThrow(
            /data\/nope\.xlsx: no such file/,
        )
    })
})
