import { existsSync, readFileSync } from 'node:fs'

/**
 * Everything `scripts/build-proposal.ts` reads about *which* proposal it is building — the
 * spreadsheet, the lines to take from it, and what to call them. Handing the build a new version
 * of the workbook is a change to this file, not to the converter.
 */
export interface ProposalConfig {
    /** The proposal spreadsheet: one sheet per city line, each named after the line. */
    workbook: string
    /** Stops the proposal adds that no feed knows yet, hand-placed — see `data/proposed-stops.json`. */
    stopOverrides: string
    /** Sheet names to import; each doubles as the proposed line's own id. */
    cityLines: string[]
    /** Lines copied from the current scenario unchanged, because the proposal changes them but
     *  supplies no timetable for the change. */
    inheritedLines: string[]
    /** The single service every proposed trip runs under. */
    serviceId: string
    /**
     * The proposal's own long names, one per `cityLines` entry, from PDF page 1 ("Uvažované vedení
     * linek") — preferred over the current scenario's long names since the routings genuinely
     * differ. Transcribed by hand, with the PDF's own spacing normalised and one typo fixed
     * ("Vatlická" -> "Valtická", the same place the workbook and every other PDF mention spell
     * correctly).
     */
    longNames: Record<string, string>
    /** Override stops the build refuses to start without: a stop row of the workbook resolves to each. */
    requiredStopOverrides: string[]
    /**
     * The second Mánesova pole the proposal adds, named apart from the rest of
     * `requiredStopOverrides` because it is the one override the generic name matcher must never
     * see: its name is identical to the existing pole's, so only `resolveManesova`'s explicit
     * neighbour rule can tell the two apart.
     */
    manesovaNewPoleId: string
}

export function loadProposalConfig(path = 'config/proposal.json'): ProposalConfig {
    const config = JSON.parse(readFileSync(path, 'utf8')) as ProposalConfig
    const problems = configProblems(config)
    if (problems.length > 0) {
        throw new Error(`${path} is not a usable proposal config:\n${problems.map((p) => `  ${p}`).join('\n')}`)
    }
    return config
}

/** Every problem at once, rather than the first — the same shape as `structuralProblems` in
 *  `scripts/build-network.ts`, so one run tells the editor everything they have to fix. */
function configProblems(config: ProposalConfig): string[] {
    const problems: string[] = []

    const lists = {
        cityLines: config.cityLines,
        inheritedLines: config.inheritedLines,
        requiredStopOverrides: config.requiredStopOverrides,
    }
    for (const [field, values] of Object.entries(lists)) {
        if (values.length === 0) {
            problems.push(`${field} is empty`)
        }
    }

    const inherited = new Set(config.inheritedLines)
    for (const line of config.cityLines) {
        if (config.longNames[line] === undefined) {
            problems.push(`cityLines has line ${line}, but longNames has no name for it`)
        }
        if (inherited.has(line)) {
            problems.push(`line ${line} is in both cityLines and inheritedLines`)
        }
    }

    if (!config.requiredStopOverrides.includes(config.manesovaNewPoleId)) {
        problems.push(`manesovaNewPoleId ${config.manesovaNewPoleId} is not one of requiredStopOverrides`)
    }

    return problems
}

/** `--workbook <path>`, alongside `build-network.ts`'s own `process.argv` flags: one run against a
 *  one-off spreadsheet, overriding nothing but `workbook`. */
export function workbookFromArgv(argv: string[]): string | undefined {
    const flag = argv.indexOf('--workbook')
    if (flag === -1) {
        return undefined
    }
    const path = argv[flag + 1]
    if (path === undefined || path.startsWith('--')) {
        throw new Error('--workbook needs a path, e.g. --workbook data/navrh_2026_v3.xlsx')
    }
    if (!existsSync(path)) {
        throw new Error(`--workbook ${path}: no such file`)
    }
    return path
}
