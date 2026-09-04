import Ajv from 'ajv/dist/2020';
import schema from '../../schema/network.schema.json';
import type { Network } from '../types/network';

const ajv = new Ajv({ allErrors: true });
const validateSchema = ajv.compile(schema);

export function validateNetwork(value: unknown): asserts value is Network {
  if (!validateSchema(value)) {
    const messages = (validateSchema.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`);
    throw new Error(`Neplatná síť (schéma):\n${messages.join('\n')}`);
  }

  const net = value as unknown as Network;
  const problems: string[] = [];
  const stopIds = new Set(net.stops.map((s) => s.id));
  const lineIds = new Set(net.lines.map((l) => l.id));
  const patternIds = new Set(net.patterns.map((p) => p.id));
  const serviceIds = new Set(net.services.map((s) => s.id));

  for (const p of net.patterns) {
    if (p.stops.length !== p.offsets.length) {
      problems.push(`pattern ${p.id}: offsets length ${p.offsets.length} != stops length ${p.stops.length}`);
    }
    if (p.dwells && p.stops.length !== p.dwells.length) {
      problems.push(`pattern ${p.id}: dwells length ${p.dwells.length} != stops length ${p.stops.length}`);
    }
    if (!lineIds.has(p.line)) problems.push(`pattern ${p.id}: unknown line ${p.line}`);
    for (const s of p.stops) if (!stopIds.has(s)) problems.push(`pattern ${p.id}: unknown stop ${s}`);
    for (const problem of timingProblems(p.offsets, p.dwells)) {
      problems.push(`pattern ${p.id}: ${problem}`);
    }
  }

  const patternStops = new Map(net.patterns.map((p) => [p.id, p.stops.length]));
  for (const t of net.trips) {
    if (!patternIds.has(t.pattern)) problems.push(`trip: unknown pattern ${t.pattern}`);
    if (!serviceIds.has(t.service)) problems.push(`trip: unknown service ${t.service}`);
    if (t.offsets && patternStops.get(t.pattern) !== t.offsets.length) {
      problems.push(`trip on ${t.pattern}: override offsets length ${t.offsets.length} != stops length`);
    }
    if (t.dwells && patternStops.get(t.pattern) !== t.dwells.length) {
      problems.push(`trip on ${t.pattern}: override dwells length ${t.dwells.length} != stops length`);
    }
    if (t.dwells && !t.offsets) {
      problems.push(`trip on ${t.pattern}: override dwells without override offsets`);
    }
    if (t.offsets) {
      for (const problem of timingProblems(t.offsets, t.dwells)) {
        problems.push(`trip on ${t.pattern}: ${problem}`);
      }
    }
  }

  for (const f of net.frequencies ?? []) {
    if (!patternIds.has(f.pattern)) problems.push(`frequency: unknown pattern ${f.pattern}`);
    if (!serviceIds.has(f.service)) problems.push(`frequency: unknown service ${f.service}`);
    if (f.to < f.from) problems.push(`frequency on ${f.pattern}: to < from`);
  }

  if (problems.length > 0) throw new Error(`Neplatná síť (reference):\n${problems.join('\n')}`);
}

/**
 * Every way one stop visit's times can contradict the next one's. Shared by patterns and by trip
 * overrides, which carry the same two vectors and so admit exactly the same faults.
 *
 * The departure check subsumes a plain decreasing-`offsets` fault, since a dwell is never
 * negative, which is why there is no separate monotonicity loop.
 *
 * The two zero-dwell rules are what actually enforce decision 32's "operator movements are never
 * drawn": a vehicle standing at its origin has not started, and the layover at its terminus
 * belongs to whatever it does next. Both are importer rules, and an importer that regressed on
 * either would silently put a parked vehicle back on the map with nothing to point at why.
 */
function timingProblems(offsets: number[], dwells: number[] | undefined): string[] {
  const problems: string[] = [];

  for (let i = 0; i + 1 < offsets.length; i += 1) {
    const departure = offsets[i]! + (dwells?.[i] ?? 0);
    if (departure > offsets[i + 1]!) {
      problems.push(`stop ${i} departs at ${departure} but stop ${i + 1} arrives at ${offsets[i + 1]}`);
    }
  }

  if (dwells) {
    const last = dwells.length - 1;
    if (dwells[0] !== 0) {
      problems.push(`dwells[0] is ${dwells[0]}, not 0 — a vehicle waiting at its origin is not running yet`);
    }
    if (last > 0 && dwells[last] !== 0) {
      problems.push(`dwells[${last}] is ${dwells[last]}, not 0 — a terminus layover belongs to the next trip`);
    }
  }

  return problems;
}
