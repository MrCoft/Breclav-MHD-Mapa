import { describe, expect, it, vi } from 'vitest'
import { buildIndex } from '../src/data/buildIndex'
import { buildPatternGeometry } from '../src/domain/patternGeometry'
import { vehiclesAt } from '../src/domain/vehicles'
import type { PatternGeometry, PatternGeometryProperties } from '../src/domain/patternGeometry'
import type { NetworkIndex } from '../src/data/buildIndex'
import type { Line, Network, Pattern, Service, Stop, Trip } from '../src/types/network'
import type { Feature, LineString } from 'geojson'

// Must match the constant `patternGeometry.ts` uses internally — see patternGeometry.test.ts for
// why this reproduces exact round-number distances rather than approximations.
const EARTH_RADIUS_METRES = 6371000
const BASE_LON = 16.9

function lonOffsetForMetres(metres: number): number {
    return (metres / EARTH_RADIUS_METRES) * (180 / Math.PI)
}

function lonFor(metres: number): number {
    return BASE_LON + lonOffsetForMetres(metres)
}

/** A straight line due east along the equator, vertices at the given cumulative metre marks. */
function equatorLineFeature(
    patternId: string,
    cumulativeMetres: number[],
): Feature<LineString, PatternGeometryProperties> {
    return {
        type: 'Feature',
        properties: { patternId, stopDistances: cumulativeMetres },
        geometry: {
            type: 'LineString',
            coordinates: cumulativeMetres.map((m) => [lonFor(m), 0]),
        },
    }
}

function testLine(id: string): Line {
    return { id, name: id, longName: id, mode: 'bus', color: '#2C89C8', textColor: '#FFFFFF' }
}

function testStops(ids: string[]): Stop[] {
    return ids.map((id, i) => ({ id, name: id, lat: 0, lon: lonFor(i * 1000) }))
}

const dailyService: Service = {
    id: 'daily',
    days: [1, 1, 1, 1, 1, 1, 1],
    from: '2026-01-01',
    to: '2026-12-31',
}

const weekdayService: Service = {
    id: 'weekday',
    days: [1, 1, 1, 1, 1, 0, 0],
    from: '2026-01-01',
    to: '2026-12-31',
}

function buildScenario(
    network: Network,
    features: Feature<LineString, PatternGeometryProperties>[],
): { index: NetworkIndex; geometries: Map<string, PatternGeometry> } {
    const index = buildIndex(network)
    const geometries = new Map(features.map((f) => [f.properties.patternId, buildPatternGeometry(f)]))
    return { index, geometries }
}

// ---------------------------------------------------------------------------------------------
// Fixture A: a 4-stop trip with plenty of time per segment (a genuine trapezoid, no fallback).
// Offsets 0/10/22/30 minutes; stop distances 0/5000/12000/18000 metres.
// ---------------------------------------------------------------------------------------------

const patternA: Pattern = {
    id: 'P-A',
    line: 'L',
    direction: 0,
    headsign: 'Terminus A',
    stops: ['a0', 'a1', 'a2', 'a3'],
    offsets: [0, 10, 22, 30],
}

const tripA: Trip = { pattern: 'P-A', service: 'daily', start: 480 }

const scenarioA = buildScenario(
    {
        stops: testStops(['a0', 'a1', 'a2', 'a3']),
        lines: [testLine('L')],
        patterns: [patternA],
        services: [dailyService],
        trips: [tripA],
    },
    [equatorLineFeature('P-A', [0, 5000, 12000, 18000])],
)

describe('vehiclesAt: invariant — exactly at each stop at its scheduled time', () => {
    it('is exactly at stop 0 at trip start, dwelling', () => {
        const [v] = vehiclesAt(scenarioA.index, scenarioA.geometries, '2026-06-15', 480)
        expect(v).toBeDefined()
        expect(v!.lon).toBeCloseTo(lonFor(0), 9)
        expect(v!.lat).toBeCloseTo(0, 9)
        expect(v!.atStop).toBe(true)
    })

    it('is exactly at stop 1 when the trip reaches its offset, dwelling', () => {
        const [v] = vehiclesAt(scenarioA.index, scenarioA.geometries, '2026-06-15', 480 + 10)
        expect(v).toBeDefined()
        expect(v!.lon).toBeCloseTo(lonFor(5000), 9)
        expect(v!.atStop).toBe(true)
    })

    it('is exactly at stop 2 when the trip reaches its offset, dwelling', () => {
        const [v] = vehiclesAt(scenarioA.index, scenarioA.geometries, '2026-06-15', 480 + 22)
        expect(v).toBeDefined()
        expect(v!.lon).toBeCloseTo(lonFor(12000), 9)
        expect(v!.atStop).toBe(true)
    })

    it('converges on stop 3 as the trip approaches its final arrival', () => {
        // The trip's running window is half-open at the top (start + offsets[last] excluded, per
        // the brief's formula), so stop 3's exact arrival instant can never itself be queried —
        // the trip has already ended there. Querying one second before it lands in the last
        // segment's deceleration phase, where distance = D - 0.5 * a * remaining^2 is exact
        // arithmetic (it does not depend on the solved cruise speed), giving an exact expected
        // value: D3 = 6000, remaining = 1s, a = 1 => distance = 6000 - 0.5 = 5999.5 m.
        const oneSecond = 1 / 60
        const [v] = vehiclesAt(scenarioA.index, scenarioA.geometries, '2026-06-15', 480 + 30 - oneSecond)
        expect(v).toBeDefined()
        expect(v!.lon).toBeCloseTo(lonFor(12000 + 5999.5), 6)
        expect(v!.atStop).toBe(false)
    })
})

describe('vehiclesAt: presence window', () => {
    it('is absent before the first departure', () => {
        expect(vehiclesAt(scenarioA.index, scenarioA.geometries, '2026-06-15', 480 - 1)).toEqual([])
    })

    it('is absent at and after the last arrival', () => {
        expect(vehiclesAt(scenarioA.index, scenarioA.geometries, '2026-06-15', 480 + 30)).toEqual([])
        expect(vehiclesAt(scenarioA.index, scenarioA.geometries, '2026-06-15', 480 + 31)).toEqual([])
    })
})

describe('vehiclesAt: dwell', () => {
    it('has not moved just after departure', () => {
        const [v] = vehiclesAt(scenarioA.index, scenarioA.geometries, '2026-06-15', 480 + 1 / 60)
        expect(v).toBeDefined()
        expect(v!.atStop).toBe(true)
        expect(v!.lon).toBeCloseTo(lonFor(0), 9)
    })

    it('has moved once the dwell has elapsed', () => {
        // 26 s after departure: 1 s into the acceleration phase, distance = 0.5 * a * t^2 = 0.5 m
        // exactly — again independent of the solved cruise speed.
        const [v] = vehiclesAt(scenarioA.index, scenarioA.geometries, '2026-06-15', 480 + 26 / 60)
        expect(v).toBeDefined()
        expect(v!.atStop).toBe(false)
        expect(v!.lon).toBeCloseTo(lonFor(0.5), 9)
    })
})

describe('vehiclesAt: tripKey', () => {
    it('is stable across frames for the same trip', () => {
        const [first] = vehiclesAt(scenarioA.index, scenarioA.geometries, '2026-06-15', 480 + 1 / 60)
        const [second] = vehiclesAt(scenarioA.index, scenarioA.geometries, '2026-06-15', 480 + 25)
        expect(first).toBeDefined()
        expect(second).toBeDefined()
        expect(first!.tripKey).toBe(second!.tripKey)
        expect(first!.tripKey).toBe('P-A:daily:480')
    })
})

// ---------------------------------------------------------------------------------------------
// Fixture B: the trapezoid algebra itself, isolated from dwell (dwellSeconds: 0). A 60-second,
// 416-metre segment with acceleration 1 m/s^2 solves to a cruise speed of exactly 8 m/s:
// D = v*T - v^2/a = 8*60 - 64 = 416. accelTime = 8 s, decelStart = 52 s.
// ---------------------------------------------------------------------------------------------

const patternB: Pattern = { id: 'P-B', line: 'L', direction: 0, headsign: 'B', stops: ['b0', 'b1'], offsets: [0, 1] }
const tripB: Trip = { pattern: 'P-B', service: 'daily', start: 0 }
const scenarioB = buildScenario(
    {
        stops: testStops(['b0', 'b1']),
        lines: [testLine('L')],
        patterns: [patternB],
        services: [dailyService],
        trips: [tripB],
    },
    [equatorLineFeature('P-B', [0, 416])],
)
const noDwell = { dwellSeconds: 0, dwellFraction: 0.4, accelMetresPerSecond2: 1 }

describe('vehiclesAt: trapezoid algebra', () => {
    it('has not moved at the instant of departure', () => {
        const [v] = vehiclesAt(scenarioB.index, scenarioB.geometries, '2026-06-15', 0, noDwell)
        expect(v!.lon).toBeCloseTo(lonFor(0), 9)
    })

    it('matches the hand-solved distance at the end of the acceleration phase (8 s -> 32 m)', () => {
        const [v] = vehiclesAt(scenarioB.index, scenarioB.geometries, '2026-06-15', 8 / 60, noDwell)
        expect(v!.lon).toBeCloseTo(lonFor(32), 6)
    })

    it('matches the hand-solved distance mid-cruise (30 s -> 208 m)', () => {
        const [v] = vehiclesAt(scenarioB.index, scenarioB.geometries, '2026-06-15', 30 / 60, noDwell)
        expect(v!.lon).toBeCloseTo(lonFor(208), 6)
    })

    it('matches the hand-solved distance at the start of the deceleration phase (52 s -> 384 m)', () => {
        const [v] = vehiclesAt(scenarioB.index, scenarioB.geometries, '2026-06-15', 52 / 60, noDwell)
        expect(v!.lon).toBeCloseTo(lonFor(384), 6)
    })
})

// ---------------------------------------------------------------------------------------------
// Fixture C: the dwell clamp. A 60-second segment with the default 25 s nominal dwell must clamp
// to 0.4 * 60 = 24 s, not 25 s.
// ---------------------------------------------------------------------------------------------

const patternC: Pattern = { id: 'P-C', line: 'L', direction: 0, headsign: 'C', stops: ['c0', 'c1'], offsets: [0, 1] }
const tripC: Trip = { pattern: 'P-C', service: 'daily', start: 0 }
const scenarioC = buildScenario(
    {
        stops: testStops(['c0', 'c1']),
        lines: [testLine('L')],
        patterns: [patternC],
        services: [dailyService],
        trips: [tripC],
    },
    [equatorLineFeature('P-C', [0, 100])],
)

describe('vehiclesAt: dwell clamp', () => {
    it('is still dwelling at 23.5 s, below the clamped 24 s dwell', () => {
        const [v] = vehiclesAt(scenarioC.index, scenarioC.geometries, '2026-06-15', 23.5 / 60)
        expect(v!.atStop).toBe(true)
    })

    it('has departed by 24.5 s — past the clamped 24 s dwell, not the nominal 25 s', () => {
        const [v] = vehiclesAt(scenarioC.index, scenarioC.geometries, '2026-06-15', 24.5 / 60)
        expect(v!.atStop).toBe(false)
    })
})

// ---------------------------------------------------------------------------------------------
// Fixture D: the degenerate long-distance case. A 5000 m segment with 95 s of motion time (120 s
// segment minus the 25 s dwell) cannot be covered at 1 m/s^2 — the discriminant is negative — so
// this falls back to linear interpolation across the motion window.
// ---------------------------------------------------------------------------------------------

const patternD: Pattern = { id: 'P-D', line: 'L', direction: 0, headsign: 'D', stops: ['d0', 'd1'], offsets: [0, 2] }
const tripD: Trip = { pattern: 'P-D', service: 'daily', start: 0 }
const scenarioD = buildScenario(
    {
        stops: testStops(['d0', 'd1']),
        lines: [testLine('L')],
        patterns: [patternD],
        services: [dailyService],
        trips: [tripD],
    },
    [equatorLineFeature('P-D', [0, 5000])],
)

describe('vehiclesAt: degenerate long-distance fallback', () => {
    it('returns finite coordinates at the linear-fallback midpoint, not NaN', () => {
        // dwell 25 s (unclamped) + half of the remaining 95 s of motion = 72.5 s in.
        const [v] = vehiclesAt(scenarioD.index, scenarioD.geometries, '2026-06-15', 72.5 / 60)
        expect(v).toBeDefined()
        expect(Number.isFinite(v!.lon)).toBe(true)
        expect(Number.isFinite(v!.lat)).toBe(true)
        expect(v!.lon).toBeCloseTo(lonFor(2500), 6)
    })
})

// ---------------------------------------------------------------------------------------------
// Fixture E: trip.offsets overriding the pattern's. Pattern offsets 0/10/20; this trip's own
// offsets are 0/8/18. Using the pattern's offsets instead would land in a different segment.
// ---------------------------------------------------------------------------------------------

const patternE: Pattern = {
    id: 'P-E',
    line: 'L',
    direction: 0,
    headsign: 'E',
    stops: ['e0', 'e1', 'e2'],
    offsets: [0, 10, 20],
}
const tripE: Trip = { pattern: 'P-E', service: 'daily', start: 0, offsets: [0, 8, 18] }
const scenarioE = buildScenario(
    {
        stops: testStops(['e0', 'e1', 'e2']),
        lines: [testLine('L')],
        patterns: [patternE],
        services: [dailyService],
        trips: [tripE],
    },
    [equatorLineFeature('P-E', [0, 1000, 2500])],
)

describe('vehiclesAt: trip.offsets override', () => {
    it('uses the trip override, not the pattern default', () => {
        const [v] = vehiclesAt(scenarioE.index, scenarioE.geometries, '2026-06-15', 8)
        expect(v).toBeDefined()
        expect(v!.atStop).toBe(true)
        expect(v!.lon).toBeCloseTo(lonFor(1000), 9)
    })
})

// ---------------------------------------------------------------------------------------------
// Fixture F: post-midnight. A trip starting at 23:50 (1430) running 25 minutes crosses midnight;
// it must still be found early the next morning, sourced from the previous service day.
// ---------------------------------------------------------------------------------------------

const patternF: Pattern = {
    id: 'P-F',
    line: 'L',
    direction: 0,
    headsign: 'F',
    stops: ['f0', 'f1', 'f2'],
    offsets: [0, 10, 25],
}
const tripF: Trip = { pattern: 'P-F', service: 'weekday', start: 1430 }
const scenarioF = buildScenario(
    {
        stops: testStops(['f0', 'f1', 'f2']),
        lines: [testLine('L')],
        patterns: [patternF],
        services: [weekdayService],
        trips: [tripF],
    },
    [equatorLineFeature('P-F', [0, 2000, 5000])],
)

// ---------------------------------------------------------------------------------------------
// Fixture G: an offsets/geometry mismatch — a pattern whose trip offsets don't line up 1:1 with
// its geometry's stop distances (a converter or geometry bug this project has hit before). It
// must not render a vehicle, and must not throw, but it must warn rather than fail in silence.
// ---------------------------------------------------------------------------------------------

const patternG: Pattern = {
    id: 'P-G',
    line: 'L',
    direction: 0,
    headsign: 'G',
    stops: ['g0', 'g1', 'g2'],
    offsets: [0, 10, 20],
}
const tripG: Trip = { pattern: 'P-G', service: 'daily', start: 0 }
const scenarioG = buildScenario(
    {
        stops: testStops(['g0', 'g1', 'g2']),
        lines: [testLine('L')],
        patterns: [patternG],
        services: [dailyService],
        trips: [tripG],
    },
    // Only two stop distances for a three-offset pattern — the mismatch.
    [equatorLineFeature('P-G', [0, 1000])],
)

describe('vehiclesAt: offsets/geometry mismatch', () => {
    it('warns once naming the pattern, and omits the vehicle rather than throwing', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        expect(() => vehiclesAt(scenarioG.index, scenarioG.geometries, '2026-06-15', 5)).not.toThrow()
        expect(vehiclesAt(scenarioG.index, scenarioG.geometries, '2026-06-15', 5)).toEqual([])
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('P-G'))
        warn.mockRestore()
    })
})

describe('vehiclesAt: post-midnight', () => {
    it('is still running just after midnight, sourced from the previous (weekday) service day', () => {
        // 2026-09-07 (Mon) and 2026-09-08 (Tue) are both plain weekday service days.
        const [v] = vehiclesAt(scenarioF.index, scenarioF.geometries, '2026-09-08', 5)
        expect(v).toBeDefined()
        expect(v!.tripKey).toBe('P-F:weekday:1430')
        expect(v!.atStop).toBe(false)
    })

    it('is absent well before midnight the same night, on a date with no active service', () => {
        // 2026-09-03 is a Thursday (weekday), but Wednesday 2026-09-02 (its previous day) is not
        // removed for `weekday`, unlike the calendar fixture used elsewhere — so instead check a
        // weekend date, where neither the weekend day nor the (also weekend) previous day runs
        // the `weekday` service at all.
        expect(vehiclesAt(scenarioF.index, scenarioF.geometries, '2026-09-13', 5)).toEqual([])
    })
})

// ---------------------------------------------------------------------------------------------
// Fixture H: a scheduled dwell. Stop 1 is arrived at 10 and left at 12, leaving 60 s for the
// 416 m to stop 2 — which solves to a cruise speed of exactly 8 m/s (416 = 8*60 - 8^2), the same
// algebra as fixture B, so every position below is exact. Fixture I is the same timetable with
// no dwells, where those 416 m instead have the whole 155 s of a 3-minute segment.
// ---------------------------------------------------------------------------------------------

const patternH: Pattern = {
    id: 'P-H',
    line: 'L',
    direction: 0,
    headsign: 'H',
    stops: ['h0', 'h1', 'h2'],
    offsets: [0, 10, 13],
    dwells: [0, 2, 0],
}
const tripH: Trip = { pattern: 'P-H', service: 'daily', start: 0 }
const scenarioH = buildScenario(
    {
        stops: testStops(['h0', 'h1', 'h2']),
        lines: [testLine('L')],
        patterns: [patternH],
        services: [dailyService],
        trips: [tripH],
    },
    [equatorLineFeature('P-H', [0, 5000, 5416])],
)

describe('vehiclesAt: scheduled dwell', () => {
    it('stands on stop 1 for the whole two minutes it is scheduled to', () => {
        expect(patternH.dwells).toEqual([0, 2, 0])
        for (const minutes of [10, 10.5, 11.5, 12 - 1 / 60]) {
            const [v] = vehiclesAt(scenarioH.index, scenarioH.geometries, '2026-06-15', minutes)
            expect(v, `at ${minutes}`).toBeDefined()
            expect(v!.atStop, `at ${minutes}`).toBe(true)
            expect(v!.lon, `at ${minutes}`).toBeCloseTo(lonFor(5000), 9)
        }
    })

    it('pulls out one second after the dwell ends', () => {
        // 1 s into the acceleration phase: 0.5 * a * t^2 = 0.5 m, independent of the cruise speed.
        const [v] = vehiclesAt(scenarioH.index, scenarioH.geometries, '2026-06-15', 12 + 1 / 60)
        expect(v!.atStop).toBe(false)
        expect(v!.lon).toBeCloseTo(lonFor(5000.5), 6)
    })

    it('then runs the leg at the 8 m/s the remaining 60 s leave, not the 2.7 m/s a folded-in dwell would', () => {
        // Hand-solved against a 60 s, 416 m trapezoid: accelerate for 8 s to 8 m/s (32 m), cruise
        // to 52 s (384 m), decelerate to a stop. Folding the dwell into the leg would leave 156 s
        // for the same 416 m and put the vehicle at 338 m at the 30 s mark instead of 208 m.
        const at = (seconds: number) =>
            vehiclesAt(scenarioH.index, scenarioH.geometries, '2026-06-15', 12 + seconds / 60)[0]
        expect(at(8)!.lon).toBeCloseTo(lonFor(5032), 6)
        expect(at(30)!.lon).toBeCloseTo(lonFor(5208), 6)
        expect(at(52)!.lon).toBeCloseTo(lonFor(5384), 6)
    })

    it('measures the synthetic pause against the travel time the dwell leaves, not the whole segment', () => {
        // A nominal pause longer than the dwell, clamped to 0.7 of the segment. Against the whole
        // 180 s segment that clamp is 126 s and would hold the vehicle past the 120 s it is
        // scheduled to wait; against the 60 s of travel the dwell leaves it is 42 s and cannot.
        const generousPause = { dwellSeconds: 200, dwellFraction: 0.7, accelMetresPerSecond2: 1 }
        const [v] = vehiclesAt(scenarioH.index, scenarioH.geometries, '2026-06-15', 12 + 1 / 60, generousPause)
        expect(v!.atStop).toBe(false)
        expect(v!.lon).toBeCloseTo(lonFor(5000.5), 6)
    })

    it('leaves the screen at the final arrival, not two minutes of dwell later', () => {
        // 1 s before arriving: deceleration phase, 416 - 0.5 * a * 1^2 = 415.5 m.
        const [v] = vehiclesAt(scenarioH.index, scenarioH.geometries, '2026-06-15', 13 - 1 / 60)
        expect(v!.lon).toBeCloseTo(lonFor(5415.5), 6)
        expect(vehiclesAt(scenarioH.index, scenarioH.geometries, '2026-06-15', 13)).toEqual([])
        expect(vehiclesAt(scenarioH.index, scenarioH.geometries, '2026-06-15', 15)).toEqual([])
    })
})

// ---------------------------------------------------------------------------------------------
// Fixture I: fixture H's timetable with `dwells` omitted — the control arm, and the guard that a
// pattern without dwells still moves exactly as it did before they existed. The 155 s left by the
// unclamped 25 s synthetic dwell cover 750 m at a cruise speed of exactly 5 m/s (750 = 5*155 - 25).
// ---------------------------------------------------------------------------------------------

const patternI: Pattern = {
    id: 'P-I',
    line: 'L',
    direction: 0,
    headsign: 'I',
    stops: ['i0', 'i1', 'i2'],
    offsets: [0, 10, 13],
}
const tripI: Trip = { pattern: 'P-I', service: 'daily', start: 0 }
const scenarioI = buildScenario(
    {
        stops: testStops(['i0', 'i1', 'i2']),
        lines: [testLine('L')],
        patterns: [patternI],
        services: [dailyService],
        trips: [tripI],
    },
    [equatorLineFeature('P-I', [0, 5000, 5750])],
)

describe('vehiclesAt: a pattern with no dwells', () => {
    it('holds for the synthetic 25 s and no longer', () => {
        expect(patternI.dwells).toBeUndefined()
        const at = (seconds: number) =>
            vehiclesAt(scenarioI.index, scenarioI.geometries, '2026-06-15', 10 + seconds / 60)[0]
        expect(at(24)!.atStop).toBe(true)
        expect(at(24)!.lon).toBeCloseTo(lonFor(5000), 9)
        expect(at(26)!.atStop).toBe(false)
        expect(at(26)!.lon).toBeCloseTo(lonFor(5000.5), 6)
    })

    it('is 312.5 m down the leg at 90 s, where fixture H is still standing at the stop', () => {
        // Hand-solved against a 155 s, 750 m trapezoid: accelerate for 5 s to 5 m/s (12.5 m), then
        // cruise — at 65 s of motion, 12.5 + 5 * 60 = 312.5 m.
        const [v] = vehiclesAt(scenarioI.index, scenarioI.geometries, '2026-06-15', 11.5)
        expect(v!.atStop).toBe(false)
        expect(v!.lon).toBeCloseTo(lonFor(5312.5), 6)
    })
})

// ---------------------------------------------------------------------------------------------
// Fixture J: `offsets` and `dwells` are read as a pair. The pattern says stop 1 is a 2-minute
// wait; one trip overrides both vectors with a 5-minute wait, and another overrides `offsets`
// alone and therefore has no wait at all. Pairing either trip's offsets with the pattern's dwells
// puts the vehicle somewhere neither of them is.
// ---------------------------------------------------------------------------------------------

const patternJ: Pattern = {
    id: 'P-J',
    line: 'L',
    direction: 0,
    headsign: 'J',
    stops: ['j0', 'j1', 'j2'],
    offsets: [0, 10, 13],
    dwells: [0, 2, 0],
}
const tripJPaired: Trip = { pattern: 'P-J', service: 'daily', start: 0, offsets: [0, 20, 26], dwells: [0, 5, 0] }
const tripJOffsetsOnly: Trip = { pattern: 'P-J', service: 'daily', start: 100, offsets: [0, 20, 26] }
const scenarioJ = buildScenario(
    {
        stops: testStops(['j0', 'j1', 'j2']),
        lines: [testLine('L')],
        patterns: [patternJ],
        services: [dailyService],
        trips: [tripJPaired, tripJOffsetsOnly],
    },
    [equatorLineFeature('P-J', [0, 5000, 5416])],
)

describe('vehiclesAt: trip.dwells override', () => {
    it("uses the trip's own five-minute dwell, not the pattern's two", () => {
        expect(patternJ.dwells).toEqual([0, 2, 0])
        expect(tripJPaired.dwells).toEqual([0, 5, 0])
        // 3 minutes after arriving: still standing. On the pattern's 2 minutes it would have left
        // a minute ago and be 103 m along.
        const [waiting] = vehiclesAt(scenarioJ.index, scenarioJ.geometries, '2026-06-15', 23)
        expect(waiting!.atStop).toBe(true)
        expect(waiting!.lon).toBeCloseTo(lonFor(5000), 9)

        // Departure at 25 leaves 60 s for 416 m — the same 8 m/s trapezoid as fixture H, so 8 s
        // out is the end of the acceleration phase at 32 m.
        const [moving] = vehiclesAt(scenarioJ.index, scenarioJ.geometries, '2026-06-15', 25 + 8 / 60)
        expect(moving!.atStop).toBe(false)
        expect(moving!.lon).toBeCloseTo(lonFor(5032), 6)
    })

    it("never lends the pattern's dwells to a trip that overrides only its offsets", () => {
        expect(tripJOffsetsOnly.dwells).toBeUndefined()
        // 26 s after arriving: past the synthetic 25 s hold and 1 s into the acceleration phase,
        // at 0.5 m. Borrowing the pattern's 2 minutes would leave it standing at the stop.
        const [v] = vehiclesAt(scenarioJ.index, scenarioJ.geometries, '2026-06-15', 100 + 20 + 26 / 60)
        expect(v!.tripKey).toBe('P-J:daily:100')
        expect(v!.atStop).toBe(false)
        expect(v!.lon).toBeCloseTo(lonFor(5000.5), 6)
    })
})

// ---------------------------------------------------------------------------------------------
// Fixture K: fixture G's mismatch, one vector along. The offsets line up with the geometry but
// the dwells do not, which is the same class of pipeline fault and is caught the same way.
// ---------------------------------------------------------------------------------------------

const patternK: Pattern = {
    id: 'P-K',
    line: 'L',
    direction: 0,
    headsign: 'K',
    stops: ['k0', 'k1', 'k2'],
    offsets: [0, 10, 20],
    dwells: [0, 2],
}
const tripK: Trip = { pattern: 'P-K', service: 'daily', start: 0 }
const scenarioK = buildScenario(
    {
        stops: testStops(['k0', 'k1', 'k2']),
        lines: [testLine('L')],
        patterns: [patternK],
        services: [dailyService],
        trips: [tripK],
    },
    [equatorLineFeature('P-K', [0, 1000, 2500])],
)

describe('vehiclesAt: dwells/offsets mismatch', () => {
    it('warns naming the pattern, and omits the vehicle rather than rendering it undwelled', () => {
        expect(patternK.offsets.length).toBe(scenarioK.geometries.get('P-K')!.stopDistances.length)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        expect(vehiclesAt(scenarioK.index, scenarioK.geometries, '2026-06-15', 5)).toEqual([])
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('P-K'))
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('2 dwells'))
        warn.mockRestore()
    })
})
