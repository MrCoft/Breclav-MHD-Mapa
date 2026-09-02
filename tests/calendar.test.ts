import { describe, expect, it } from 'vitest';
import { previousDate, servicesOnDate, weekdayIndex } from '../src/domain/calendar';
import { tinyNetwork } from './fixtures/tinyNetwork';

const services = tinyNetwork.services;

describe('weekdayIndex', () => {
  it('maps Monday to 0 and Sunday to 6', () => {
    expect(weekdayIndex('2026-09-07')).toBe(0); // Monday
    expect(weekdayIndex('2026-09-13')).toBe(6); // Sunday
  });
});

describe('previousDate', () => {
  it('steps back one day', () => {
    expect(previousDate('2026-09-02')).toBe('2026-09-01');
  });

  it('steps back across a month boundary', () => {
    expect(previousDate('2026-09-01')).toBe('2026-08-31');
  });
});

describe('servicesOnDate', () => {
  it('returns the weekday service on a Wednesday', () => {
    expect(servicesOnDate(services, '2026-09-02')).toEqual(new Set(['weekday']));
  });

  it('returns the weekend service on a Sunday', () => {
    expect(servicesOnDate(services, '2026-09-13')).toEqual(new Set(['weekend']));
  });

  it('honours a removed date even though the day mask matches', () => {
    // 2026-09-03 is a Thursday, listed in weekday.removed
    expect(servicesOnDate(services, '2026-09-03')).toEqual(new Set());
  });

  it('honours an added date even though the day mask does not match', () => {
    // 2026-09-05 is a Saturday, listed in weekday.added
    expect(servicesOnDate(services, '2026-09-05')).toEqual(new Set(['weekday', 'weekend']));
  });

  it('excludes dates outside the validity range', () => {
    expect(servicesOnDate(services, '2025-12-31')).toEqual(new Set());
    expect(servicesOnDate(services, '2027-01-01')).toEqual(new Set());
  });

  it('includes both ends of the validity range', () => {
    // 2026-01-01 is a Thursday, 2026-12-31 is a Thursday
    expect(servicesOnDate(services, '2026-01-01')).toEqual(new Set(['weekday']));
    expect(servicesOnDate(services, '2026-12-31')).toEqual(new Set(['weekday']));
  });
});
