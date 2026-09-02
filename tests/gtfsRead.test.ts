import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadScope, streamCsv } from '../scripts/gtfs/read'

describe('loadScope', () => {
    it('reads the municipality and feed url', () => {
        const scope = loadScope()
        expect(scope.municipality).toBe('Břeclav')
        expect(scope.feedUrl).toMatch(/^https:\/\//)
    })
})

describe('streamCsv', () => {
    it('parses rows and strips the UTF-8 BOM from the header', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'gtfs-'))
        const file = join(dir, 'stops.txt')
        writeFileSync(file, '﻿stop_id,stop_name\nU1,"Břeclav, aut.nádr."\nU2,Poštorná\n', 'utf8')

        const rows: Record<string, string>[] = []
        await streamCsv<Record<string, string>>(file, (row) => rows.push(row))

        expect(rows).toEqual([
            { stop_id: 'U1', stop_name: 'Břeclav, aut.nádr.' },
            { stop_id: 'U2', stop_name: 'Poštorná' },
        ])
    })

    it('rejects when the source file does not exist, instead of crashing the process', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'gtfs-'))
        const missing = join(dir, 'does-not-exist.txt')

        await expect(streamCsv(missing, () => {})).rejects.toThrow()
    })
})
