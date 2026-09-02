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
    if (!lineIds.has(p.line)) problems.push(`pattern ${p.id}: unknown line ${p.line}`);
    for (const s of p.stops) if (!stopIds.has(s)) problems.push(`pattern ${p.id}: unknown stop ${s}`);
    for (let i = 1; i < p.offsets.length; i += 1) {
      if (p.offsets[i]! < p.offsets[i - 1]!) problems.push(`pattern ${p.id}: offsets decrease at index ${i}`);
    }
  }

  const patternStops = new Map(net.patterns.map((p) => [p.id, p.stops.length]));
  for (const t of net.trips) {
    if (!patternIds.has(t.pattern)) problems.push(`trip: unknown pattern ${t.pattern}`);
    if (!serviceIds.has(t.service)) problems.push(`trip: unknown service ${t.service}`);
    if (t.offsets && patternStops.get(t.pattern) !== t.offsets.length) {
      problems.push(`trip on ${t.pattern}: override offsets length ${t.offsets.length} != stops length`);
    }
  }

  for (const f of net.frequencies ?? []) {
    if (!patternIds.has(f.pattern)) problems.push(`frequency: unknown pattern ${f.pattern}`);
    if (!serviceIds.has(f.service)) problems.push(`frequency: unknown service ${f.service}`);
    if (f.to < f.from) problems.push(`frequency on ${f.pattern}: to < from`);
  }

  if (problems.length > 0) throw new Error(`Neplatná síť (reference):\n${problems.join('\n')}`);
}
