import yauzl from 'yauzl'

/**
 * Minimal .xlsx reader: an .xlsx is a zip of XML parts, and the parts this converter needs
 * (shared strings, the workbook's sheet index, one grid per sheet) are simple enough to pull
 * out with regular expressions rather than pulling in a general-purpose XML/XLSX dependency,
 * mirroring `scripts/analysis/inspect_proposal.py`'s own approach to the same file. Reuses
 * `yauzl` (already a dependency for the GTFS feed zip) instead of adding a new one.
 */

const MAIN_T = /<t\b[^>]*>([\s\S]*?)<\/t>/g
const SI = /<si\b[^>]*>([\s\S]*?)<\/si>/g
const RELATIONSHIP = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/>/g
const SHEET = /<sheet\b[^>]*\bname="([^"]+)"[^>]*\br:id="([^"]+)"[^>]*\/>/g
const CELL = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
const CELL_REF = /\br="([A-Z]+)(\d+)"/
const CELL_TYPE = /\bt="([^"]+)"/
const INLINE_STRING = /<is>([\s\S]*?)<\/is>/
const CELL_VALUE = /<v>([\s\S]*?)<\/v>/

function decodeXmlEntities(text: string): string {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
        .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
        .replace(/&amp;/g, '&')
}

function textOf(fragment: string): string {
    let text = ''
    MAIN_T.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = MAIN_T.exec(fragment))) {
        text += decodeXmlEntities(match[1]!)
    }
    return text
}

/** `xl/sharedStrings.xml` -> the string table cells reference by index. */
export function parseSharedStrings(xml: string): string[] {
    const strings: string[] = []
    SI.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = SI.exec(xml))) {
        strings.push(textOf(match[1]!))
    }
    return strings
}

/** `xl/_rels/workbook.xml.rels` -> relationship id to part path (e.g. `worksheets/sheet1.xml`). */
export function parseWorkbookRels(xml: string): Map<string, string> {
    const targets = new Map<string, string>()
    RELATIONSHIP.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = RELATIONSHIP.exec(xml))) {
        targets.set(match[1]!, match[2]!)
    }
    return targets
}

/** `xl/workbook.xml` + its rels -> sheet display names paired with their part paths, in tab order. */
export function parseSheetIndex(workbookXml: string, relsXml: string): { name: string; target: string }[] {
    const targets = parseWorkbookRels(relsXml)
    const sheets: { name: string; target: string }[] = []
    SHEET.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = SHEET.exec(workbookXml))) {
        const target = targets.get(match[2]!)
        if (target) {
            sheets.push({ name: match[1]!.trim(), target })
        }
    }
    return sheets
}

/** A sheet's cells as `"<row>:<column letters>"` -> raw text, formulas and styling stripped. */
export function parseSheetGrid(xml: string, sharedStrings: string[]): Map<string, string> {
    const grid = new Map<string, string>()
    CELL.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = CELL.exec(xml))) {
        const attrs = match[1] ?? ''
        const body = match[2]
        if (body === undefined) {
            continue // self-closing <c/>: no value
        }
        const ref = CELL_REF.exec(attrs)
        if (!ref) {
            continue
        }
        const type = CELL_TYPE.exec(attrs)?.[1]

        const inline = INLINE_STRING.exec(body)
        let text: string | undefined
        if (inline) {
            text = textOf(inline[1]!)
        } else {
            const value = CELL_VALUE.exec(body)
            if (!value) {
                continue
            }
            const raw = decodeXmlEntities(value[1]!)
            text = type === 's' ? sharedStrings[Number(raw)] : raw
        }
        if (text !== undefined) {
            grid.set(`${ref[2]}:${ref[1]}`, text)
        }
    }
    return grid
}

/** Reads the named entries of a zip archive into memory, keyed by their in-archive path. */
function readZipEntries(path: string, wanted: (name: string) => boolean): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>()
    return new Promise((resolve, reject) => {
        yauzl.open(path, { lazyEntries: true }, (err, zip) => {
            // @types/yauzl declares `zip` as always present, but yauzl's real callback omits it on error.
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (err || !zip) {
                reject(err ?? new Error(`cannot open ${path}`))
                return
            }
            zip.on('error', reject)
            zip.on('end', () => resolve(out))
            zip.readEntry()

            zip.on('entry', (entry) => {
                if (!wanted(entry.fileName)) {
                    zip.readEntry()
                    return
                }
                zip.openReadStream(entry, (streamErr, stream) => {
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                    if (streamErr || !stream) {
                        reject(streamErr ?? new Error(`cannot read ${entry.fileName}`))
                        return
                    }
                    const chunks: Buffer[] = []
                    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
                    stream.on('end', () => {
                        out.set(entry.fileName, Buffer.concat(chunks))
                        zip.readEntry()
                    })
                    stream.on('error', reject)
                })
            })
        })
    })
}

export interface WorkbookSheet {
    name: string
    grid: Map<string, string>
}

/** Reads every line sheet of an .xlsx workbook (skips the ones `sheetFilter` rejects). */
export async function readWorkbook(
    path: string,
    sheetFilter: (name: string) => boolean = () => true,
): Promise<WorkbookSheet[]> {
    const bootstrap = await readZipEntries(
        path,
        (name) =>
            name === 'xl/workbook.xml' || name === 'xl/_rels/workbook.xml.rels' || name === 'xl/sharedStrings.xml',
    )
    const workbookXml = bootstrap.get('xl/workbook.xml')?.toString('utf8')
    const relsXml = bootstrap.get('xl/_rels/workbook.xml.rels')?.toString('utf8')
    if (!workbookXml || !relsXml) {
        throw new Error(`${path}: missing xl/workbook.xml or its relationships`)
    }
    const sharedStrings = parseSharedStrings(bootstrap.get('xl/sharedStrings.xml')?.toString('utf8') ?? '')
    const index = parseSheetIndex(workbookXml, relsXml).filter((s) => sheetFilter(s.name))

    const partNames = new Set(index.map((s) => `xl/${s.target.replace(/^\/?xl\//, '')}`))
    const parts = await readZipEntries(path, (name) => partNames.has(name))

    return index.map(({ name, target }) => {
        const partName = `xl/${target.replace(/^\/?xl\//, '')}`
        const xml = parts.get(partName)
        if (!xml) {
            throw new Error(`${path}: sheet '${name}' part ${partName} missing from archive`)
        }
        return { name, grid: parseSheetGrid(xml.toString('utf8'), sharedStrings) }
    })
}
