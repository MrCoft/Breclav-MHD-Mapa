import { describe, expect, it } from 'vitest';
import { validateNetwork } from '../src/data/validate';
import { tinyNetwork } from './fixtures/tinyNetwork';

describe('validateNetwork', () => {
  it('accepts the fixture network', () => {
    expect(() => validateNetwork(structuredClone(tinyNetwork))).not.toThrow();
  });

  it('rejects a pattern whose offsets length differs from its stops length', () => {
    const bad = structuredClone(tinyNetwork);
    bad.patterns[0]!.offsets = [0, 4];
    expect(() => validateNetwork(bad)).toThrow(/offsets/i);
  });

  it('rejects a trip referencing an unknown pattern', () => {
    const bad = structuredClone(tinyNetwork);
    bad.trips[0]!.pattern = 'nope';
    expect(() => validateNetwork(bad)).toThrow(/nope/);
  });

  it('rejects a pattern referencing an unknown stop', () => {
    const bad = structuredClone(tinyNetwork);
    bad.patterns[0]!.stops[1] = 'ghost';
    expect(() => validateNetwork(bad)).toThrow(/ghost/);
  });

  it('rejects a day mask of the wrong length', () => {
    const bad = structuredClone(tinyNetwork) as unknown as { services: { days: number[] }[] };
    bad.services[0]!.days = [1, 1, 1];
    expect(() => validateNetwork(bad)).toThrow();
  });
});
