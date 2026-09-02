import { describe, expect, it } from 'vitest'
import { parseSharedStrings, parseSheetGrid, parseSheetIndex, parseWorkbookRels } from '../scripts/proposal/xlsx'

describe('parseSharedStrings', () => {
    it('reads a plain <si><t>…</t></si> entry', () => {
        const xml = `<sst><si><t>Tč</t></si><si><t>Autobusové nádraží</t></si></sst>`
        expect(parseSharedStrings(xml)).toEqual(['Tč', 'Autobusové nádraží'])
    })

    it('joins a rich-text entry split across multiple <r><t>…</t></r> runs', () => {
        const xml = `<sst><si><r><t>Poštorná,</t></r><r><t>kostel</t></r></si></sst>`
        expect(parseSharedStrings(xml)).toEqual(['Poštorná,kostel'])
    })

    it('decodes XML entities', () => {
        const xml = `<sst><si><t>A &amp; B &lt;C&gt;</t></si></sst>`
        expect(parseSharedStrings(xml)).toEqual(['A & B <C>'])
    })
})

describe('parseWorkbookRels + parseSheetIndex', () => {
    const rels = `<Relationships><Relationship Id="rId2" Type="worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId1" Type="sharedStrings" Target="sharedStrings.xml"/></Relationships>`
    const workbook = `<workbook><sheets><sheet name="komentzář a km" sheetId="21" r:id="rId1"/><sheet name="561 " sheetId="11" r:id="rId2"/></sheets></workbook>`

    it('maps a relationship id to its part path', () => {
        expect(parseWorkbookRels(rels).get('rId2')).toBe('worksheets/sheet1.xml')
    })

    it('pairs sheet names with their part path, in document order, trimmed', () => {
        expect(parseSheetIndex(workbook, rels)).toEqual([
            { name: 'komentzář a km', target: 'sharedStrings.xml' },
            { name: '561', target: 'worksheets/sheet1.xml' },
        ])
    })
})

describe('parseSheetGrid', () => {
    const sharedStrings = ['Tč', 'Autobusové nádraží']

    it('reads a shared-string cell', () => {
        const xml = `<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData>`
        expect(parseSheetGrid(xml, sharedStrings)).toEqual(new Map([['1:A', 'Tč']]))
    })

    it('reads a plain numeric cell (no t attribute) as its raw text', () => {
        const xml = `<sheetData><row r="4"><c r="D4"><v>0.21875</v></c></row></sheetData>`
        expect(parseSheetGrid(xml, sharedStrings)).toEqual(new Map([['4:D', '0.21875']]))
    })

    it('skips a formula element and reads the cached value after it', () => {
        const xml = `<sheetData><row r="4"><c r="E4"><f>D4+2</f><v>3</v></c></row></sheetData>`
        expect(parseSheetGrid(xml, sharedStrings)).toEqual(new Map([['4:E', '3']]))
    })

    it('reads an inline string cell', () => {
        const xml = `<sheetData><row r="5"><c r="B5" t="inlineStr"><is><t>Jana Palacha</t></is></c></row></sheetData>`
        expect(parseSheetGrid(xml, sharedStrings)).toEqual(new Map([['5:B', 'Jana Palacha']]))
    })

    it('reads a literal HH:MM text cell typed as a string result', () => {
        const xml = `<sheetData><row r="19"><c r="D19" t="str"><v>5:14</v></c></row></sheetData>`
        expect(parseSheetGrid(xml, sharedStrings)).toEqual(new Map([['19:D', '5:14']]))
    })

    it('skips a self-closing (empty) cell', () => {
        const xml = `<sheetData><row r="4"><c r="C4" s="122"/><c r="D4"><v>1</v></c></row></sheetData>`
        expect(parseSheetGrid(xml, sharedStrings)).toEqual(new Map([['4:D', '1']]))
    })

    it('handles multi-letter columns', () => {
        const xml = `<sheetData><row r="4"><c r="AH4"><v>61</v></c></row></sheetData>`
        expect(parseSheetGrid(xml, sharedStrings)).toEqual(new Map([['4:AH', '61']]))
    })
})
