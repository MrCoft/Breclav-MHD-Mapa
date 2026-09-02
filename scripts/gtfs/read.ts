import { createReadStream, createWriteStream, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { parse } from 'csv-parse'
import yauzl from 'yauzl'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

export interface ScopeConfig {
    feedUrl: string
    municipality: string
    bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number }
    overpassUrl: string
    osmNetwork: string
    expectedRoutes: { min: number; max: number }
}

export function loadScope(path = 'config/scope.json'): ScopeConfig {
    return JSON.parse(readFileSync(path, 'utf8')) as ScopeConfig
}

/**
 * Downloads the feed unless a local copy is already current. Returns the feed's
 * Last-Modified date, which becomes `meta.feedDate`.
 */
export async function downloadFeed(url: string, destDir: string): Promise<{ zipPath: string; feedDate: string }> {
    mkdirSync(destDir, { recursive: true })
    const zipPath = join(destDir, 'gtfs.zip')

    const head = await fetch(url, { method: 'HEAD' })
    if (!head.ok) {
        throw new Error(`HEAD ${url} failed: ${head.status}`)
    }
    const lastModified = head.headers.get('last-modified')
    const feedDate = lastModified
        ? new Date(lastModified).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10)

    let haveCurrent = false
    try {
        const local = statSync(zipPath)
        haveCurrent = lastModified !== null && local.mtime >= new Date(lastModified)
    } catch {
        haveCurrent = false
    }

    if (!haveCurrent) {
        const res = await fetch(url)
        if (!res.ok || !res.body) {
            throw new Error(`GET ${url} failed: ${res.status}`)
        }
        await pipeline(res.body as WebReadableStream<Uint8Array>, createWriteStream(zipPath))
    }

    return { zipPath, feedDate }
}

/** Extracts the named entries to `destDir`, streaming rather than buffering. */
export function extractEntries(zipPath: string, destDir: string, names: string[]): Promise<void> {
    mkdirSync(destDir, { recursive: true })
    const wanted = new Set(names)

    return new Promise((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
            // @types/yauzl declares `zip` as always present, but yauzl's real callback omits it on error.
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (err || !zip) {
                return reject(err ?? new Error('cannot open zip'))
            }

            zip.on('error', reject)
            zip.on('end', resolve)
            zip.readEntry()

            zip.on('entry', (entry) => {
                if (!wanted.has(entry.fileName)) {
                    zip.readEntry()
                    return
                }
                zip.openReadStream(entry, (streamErr, stream) => {
                    // @types/yauzl declares `stream` as always present, but yauzl's real callback omits it on error.
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                    if (streamErr || !stream) {
                        return reject(streamErr ?? new Error('cannot read entry'))
                    }
                    const out = join(destDir, entry.fileName)
                    mkdirSync(dirname(out), { recursive: true })
                    stream
                        .pipe(createWriteStream(out))
                        .on('close', () => zip.readEntry())
                        .on('error', reject)
                })
            })
        })
    })
}

/**
 * Streams a CSV file row by row. Never holds the whole file in memory.
 *
 * The source stream is piped into the parser explicitly (rather than via a bare
 * `.pipe()` chain) so that a source 'error' event forwards into the parser: bare
 * `.pipe()` does not propagate errors, so a missing or unreadable file would raise an
 * unhandled event instead of rejecting this promise.
 */
export async function streamCsv<T>(path: string, onRow: (row: T) => void): Promise<void> {
    const source = createReadStream(path)
    const parser = parse({ columns: true, bom: true, skip_empty_lines: true })
    source.on('error', (err) => parser.destroy(err))
    source.pipe(parser)

    for await (const row of parser) {
        onRow(row as T)
    }
}
