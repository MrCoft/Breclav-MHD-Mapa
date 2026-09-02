import type { Service } from '../types/network';

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(date: string): number {
  const d = new Date(`${date}T00:00:00Z`);
  return (d.getUTCDay() + 6) % 7;
}

export function previousDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Ids of services running on `date`. `removed` beats everything; `added`
 * beats the day mask and the validity range.
 */
export function servicesOnDate(services: Iterable<Service>, date: string): Set<string> {
  const dow = weekdayIndex(date);
  const active = new Set<string>();
  for (const s of services) {
    if (s.removed?.includes(date)) {
      continue;
    }
    if (s.added?.includes(date)) {
      active.add(s.id);
      continue;
    }
    // YYYY-MM-DD strings compare correctly with < and >.
    if (date < s.from || date > s.to) {
      continue;
    }
    if (s.days[dow] === 1) {
      active.add(s.id);
    }
  }
  return active;
}
