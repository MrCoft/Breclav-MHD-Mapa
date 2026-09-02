# Břeclav MHD Mapa Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static interactive map of public transport serving Břeclav, deployed to GitHub Pages, whose network is loaded from a swappable scenario file.

**Architecture:** A Node converter turns the IDS JMK GTFS feed plus OpenStreetMap route geometry into a small scenario bundle (`network.json` + `geometry.geojson`), committed to the repo. A React + MapLibre client renders whatever scenario bundle it is given and knows nothing about GTFS. Deployment is a single GitHub Actions workflow that builds and publishes to Pages.

**Tech Stack:** Vite, TypeScript, React, MapLibre GL JS, Zustand, Vitest, Playwright, tsx, yauzl, csv-parse, ajv, Turf.

**Spec:** `docs/superpowers/specs/2026-09-02-breclav-mhd-mapa-design.md`

## Global Constraints

- Node 26.x, npm 11.x. The repo remote is `git@github.com:MrCoft/Breclav-MHD-Mapa.git`.
- Vite `base` is `/Breclav-MHD-Mapa/`. The deployed URL is `https://mrcoft.github.io/Breclav-MHD-Mapa/`. All runtime fetches of data files MUST go through `import.meta.env.BASE_URL`.
- **No API keys anywhere.** GitHub Pages serves the bundle publicly; anything shipped is public. The basemap is OpenFreeMap (`https://tiles.openfreemap.org/styles/liberty`), which requires none.
- All times are **integer minutes since midnight of the service day**. Values ≥ 1440 are legal and mean "after midnight". Never store times as strings.
- Service day masks are 7-element arrays where **index 0 is Monday**.
- All stop references are **parent-station ids**. Platform-level ids never appear outside `scripts/gtfs/`.
- All generated output is sorted deterministically before writing, so regeneration yields minimal diffs.
- UI copy is Czech only. No i18n layer.
- Attribution is mandatory and must be visible in the UI: timetable data © KORDIS JMK, CC-BY-4.0; map data © OpenStreetMap contributors, ODbL.
- Generated scenario data under `public/data/` and the Overpass cache under `data/cache/osm/` are committed. Extracted GTFS CSVs under `data/cache/gtfs/` are not.
- Every `if`, `else`, `for` and `while` body is braced, even a single statement.
- **The toolchain changed after this plan was written.** The project now uses pnpm, Tailwind 4,
  shadcn/ui, Storybook, ESLint and Prettier, copied from the user's reference React project.
  Use `pnpm` for every command in this plan: `pnpm install`, `pnpm test`, `pnpm run build`,
  `pnpm lint`. `npm` commands in task steps below predate the switch — translate them.
- **This plan's code blocks are written in the old formatting style** (semicolons, two-space
  indent, double quotes in places). The project's Prettier config is now the reference
  project's: no semicolons, single quotes, trailing commas, tab width 4, print width 120.
  Transcribe the plan's code for its *logic*, then run `pnpm exec prettier --write` on the
  files you touched before committing. Do not hand-reformat, and do not treat Prettier's
  changes as deviations from the brief.
- React components are arrow functions, not function declarations
  (`react/function-component-definition`). No default exports under `src/` except Storybook
  stories and `*.d.ts` (`import/no-default-export`).
- `@/` is an alias for `src/`.
- The full check is now typecheck, lint and tests: `pnpm run build`, `pnpm lint`, `pnpm test`.
  All three must pass before a task is done.
- One thing per file, named after the file.
- Before calling a task done, run the project's full check — typecheck and tests (`npm run build` and `npm test`). There is no linter configured yet; see `docs/open-questions.md`.

---

### Task 1: Project scaffold and Pages deployment

Get an empty page live on GitHub Pages first, so every later task deploys through a path already proven to work.

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/ui/App.tsx`, `.gitignore`, `.github/workflows/deploy.yml`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `npm test` (Vitest), `npm run build` (Vite), a deployed Pages site.

- [ ] **Step 1: Initialise the project and install dependencies**

```bash
npm init -y
npm pkg set name="breclav-mhd-mapa" private=true type="module"
npm pkg set scripts.dev="vite" scripts.build="tsc -b && vite build" scripts.preview="vite preview" scripts.test="vitest run"
npm install react react-dom maplibre-gl zustand
npm install -D vite @vitejs/plugin-react typescript @types/react @types/react-dom vitest tsx
```

- [ ] **Step 2: Write the failing test**

This guards the Pages subpath, which is the single most common way a Pages deploy renders a blank page.

```ts
// tests/config.test.ts
import { describe, expect, it } from 'vitest';
import config from '../vite.config';

describe('vite config', () => {
  it('uses the GitHub Pages project subpath as base', () => {
    expect(config.base).toBe('/Breclav-MHD-Mapa/');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — cannot resolve `../vite.config`.

- [ ] **Step 4: Write the config files**

```ts
// vite.config.ts
// defineConfig must come from vitest/config — vite's own does not accept `test`.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/Breclav-MHD-Mapa/',
  plugins: [react()],
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tests", "scripts", "vite.config.ts"]
}
```

`tsconfig.node.json` is not needed with this single-config setup; skip it.

```html
<!-- index.html -->
<!doctype html>
<html lang="cs">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MHD Břeclav — mapa</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

```tsx
// src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

```tsx
// src/ui/App.tsx
export function App() {
  return <main>MHD Břeclav</main>;
}
```

```gitignore
node_modules/
dist/
data/cache/gtfs/
playwright-report/
test-results/
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS.

- [ ] **Step 6: Add the deploy workflow**

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 7: Enable Pages with GitHub Actions as the source**

```bash
gh api --method POST repos/MrCoft/Breclav-MHD-Mapa/pages -f build_type=workflow
```

If that returns 409 the site already exists; switch it instead:

```bash
gh api --method PUT repos/MrCoft/Breclav-MHD-Mapa/pages -f build_type=workflow
```

Manual fallback: repository Settings → Pages → Source → "GitHub Actions".

- [ ] **Step 8: Verify the build works locally**

Run: `npm run build`
Expected: `dist/` is produced with no TypeScript errors.

- [ ] **Step 9: Commit and push**

```bash
git add -A
git commit -m "feat: scaffold Vite/React/TS app and GitHub Pages deploy"
git push -u origin main
```

- [ ] **Step 10: Verify the deployment**

Run: `gh run watch`
Then open `https://mrcoft.github.io/Breclav-MHD-Mapa/` and confirm it shows "MHD Břeclav". Do not proceed until this renders — every later task depends on this path being correct.

---

### Task 2: Network types, JSON Schema, and validator

**Files:**
- Create: `src/types/network.ts`, `schema/network.schema.json`, `src/data/validate.ts`, `tests/fixtures/tinyNetwork.ts`
- Test: `tests/validate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - Types `Stop`, `Line`, `Pattern`, `Service`, `Trip`, `FrequencyBlock`, `Network`, `Meta`, `ScenarioRef`, `Mode`, `DayMask`.
  - `validateNetwork(value: unknown): asserts value is Network` — throws `Error` listing every schema violation.
  - `tinyNetwork: Network` — the shared fixture used by Tasks 3, 4, and 5.

- [ ] **Step 1: Install ajv**

```bash
npm install -D ajv
```

- [ ] **Step 2: Write the types**

```ts
// src/types/network.ts
export type Mode = 'bus' | 'rail';

/** Seven flags, index 0 = Monday. */
export type DayMask = [number, number, number, number, number, number, number];

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  zone?: string;
  wheelchair?: boolean;
  /** Originating GTFS parent-station id, for debugging. Absent in hand-authored scenarios. */
  sourceId?: string;
}

export interface Line {
  id: string;
  name: string;
  longName: string;
  mode: Mode;
  color: string;
  textColor: string;
}

export interface Pattern {
  id: string;
  line: string;
  direction: 0 | 1;
  headsign: string;
  /** Stop ids in travel order. May repeat if the pattern loops. */
  stops: string[];
  /** Minutes from trip start, one per entry in `stops`. Same length as `stops`. */
  offsets: number[];
}

export interface Service {
  id: string;
  days: DayMask;
  /** Inclusive YYYY-MM-DD bounds. */
  from: string;
  to: string;
  /** Dates that run regardless of the day mask. */
  added?: string[];
  /** Dates that never run, overriding everything else. */
  removed?: string[];
}

export interface Trip {
  pattern: string;
  service: string;
  /** Minutes since midnight of the service day. May exceed 1440. */
  start: number;
  /** Overrides the pattern's offsets when this trip's run times differ. */
  offsets?: number[];
}

export interface FrequencyBlock {
  pattern: string;
  service: string;
  from: number;
  to: number;
  headway: number;
}

export interface Network {
  stops: Stop[];
  lines: Line[];
  patterns: Pattern[];
  services: Service[];
  trips: Trip[];
  frequencies?: FrequencyBlock[];
}

export interface Meta {
  /** Last-Modified date of the source gtfs.zip, YYYY-MM-DD. */
  feedDate: string;
  generatedAt: string;
  converterVersion: string;
  geometrySources: { osm: number; straight: number; override: number };
}

export interface ScenarioRef {
  id: string;
  label: string;
}
```

- [ ] **Step 3: Write the failing test**

```ts
// tests/validate.test.ts
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
```

- [ ] **Step 4: Write the fixture**

Two stops on one line, a weekday service, and three trips — one of which carries an offset override, because 38% of real trips do.

```ts
// tests/fixtures/tinyNetwork.ts
import type { Network } from '../../src/types/network';

export const tinyNetwork: Network = {
  stops: [
    { id: 'a', name: 'Břeclav, aut.nádr.', lat: 48.7546, lon: 16.8932, zone: '575', wheelchair: true },
    { id: 'b', name: 'Břeclav, Poštorná', lat: 48.7402, lon: 16.8871, zone: '575' },
    { id: 'c', name: 'Břeclav, FOSFA', lat: 48.7331, lon: 16.8825, zone: '575' },
  ],
  lines: [
    { id: '563', name: '563', longName: 'Břeclav: Aut. nádraží - Poštorná, FOSFA', mode: 'bus', color: '#2C89C8', textColor: '#FFFFFF' },
  ],
  patterns: [
    { id: '563-0-1', line: '563', direction: 0, headsign: 'Poštorná, FOSFA', stops: ['a', 'b', 'c'], offsets: [0, 4, 9] },
  ],
  services: [
    { id: 'weekday', days: [1, 1, 1, 1, 1, 0, 0], from: '2026-01-01', to: '2026-12-31', added: ['2026-09-05'], removed: ['2026-09-03'] },
    { id: 'weekend', days: [0, 0, 0, 0, 0, 1, 1], from: '2026-01-01', to: '2026-12-31' },
  ],
  trips: [
    { pattern: '563-0-1', service: 'weekday', start: 374 },
    { pattern: '563-0-1', service: 'weekday', start: 1450, offsets: [0, 3, 7] },
    { pattern: '563-0-1', service: 'weekend', start: 600 },
  ],
};
```

- [ ] **Step 5: Write the schema**

```json
// schema/network.schema.json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["stops", "lines", "patterns", "services", "trips"],
  "additionalProperties": false,
  "properties": {
    "stops": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "lat", "lon"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "minLength": 1 },
          "name": { "type": "string", "minLength": 1 },
          "lat": { "type": "number", "minimum": -90, "maximum": 90 },
          "lon": { "type": "number", "minimum": -180, "maximum": 180 },
          "zone": { "type": "string" },
          "wheelchair": { "type": "boolean" },
          "sourceId": { "type": "string" }
        }
      }
    },
    "lines": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name", "longName", "mode", "color", "textColor"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "minLength": 1 },
          "name": { "type": "string", "minLength": 1 },
          "longName": { "type": "string" },
          "mode": { "enum": ["bus", "rail"] },
          "color": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" },
          "textColor": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$" }
        }
      }
    },
    "patterns": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "line", "direction", "headsign", "stops", "offsets"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "minLength": 1 },
          "line": { "type": "string", "minLength": 1 },
          "direction": { "enum": [0, 1] },
          "headsign": { "type": "string" },
          "stops": { "type": "array", "minItems": 2, "items": { "type": "string" } },
          "offsets": { "type": "array", "minItems": 2, "items": { "type": "integer", "minimum": 0 } }
        }
      }
    },
    "services": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "days", "from", "to"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "minLength": 1 },
          "days": { "type": "array", "minItems": 7, "maxItems": 7, "items": { "enum": [0, 1] } },
          "from": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
          "to": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
          "added": { "type": "array", "items": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" } },
          "removed": { "type": "array", "items": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" } }
        }
      }
    },
    "trips": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["pattern", "service", "start"],
        "additionalProperties": false,
        "properties": {
          "pattern": { "type": "string" },
          "service": { "type": "string" },
          "start": { "type": "integer", "minimum": 0 },
          "offsets": { "type": "array", "minItems": 2, "items": { "type": "integer", "minimum": 0 } }
        }
      }
    },
    "frequencies": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["pattern", "service", "from", "to", "headway"],
        "additionalProperties": false,
        "properties": {
          "pattern": { "type": "string" },
          "service": { "type": "string" },
          "from": { "type": "integer", "minimum": 0 },
          "to": { "type": "integer", "minimum": 0 },
          "headway": { "type": "integer", "minimum": 1 }
        }
      }
    }
  }
}
```

- [ ] **Step 6: Write the validator**

JSON Schema cannot express cross-collection reference integrity or the offsets/stops length equality, so those are checked in code afterwards.

```ts
// src/data/validate.ts
import Ajv from 'ajv';
import schema from '../../schema/network.schema.json';
import type { Network } from '../types/network';

const ajv = new Ajv({ allErrors: true });
const validateSchema = ajv.compile(schema);

export function validateNetwork(value: unknown): asserts value is Network {
  if (!validateSchema(value)) {
    const messages = (validateSchema.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`);
    throw new Error(`Neplatná síť (schéma):\n${messages.join('\n')}`);
  }

  const net = value as Network;
  const problems: string[] = [];
  const stopIds = new Set(net.stops.map((s) => s.id));
  const lineIds = new Set(net.lines.map((l) => l.id));
  const patternIds = new Set(net.patterns.map((p) => p.id));
  const serviceIds = new Set(net.services.map((s) => s.id));

  for (const p of net.patterns) {
    if (p.stops.length !== p.offsets.length) {
      problems.push(`pattern ${p.id}: offsets length ${p.offsets.length} != stops length ${p.stops.length}`);
    }
    if (!lineIds.has(p.line)) {
      problems.push(`pattern ${p.id}: unknown line ${p.line}`);
    }
    for (const s of p.stops) {
      if (!stopIds.has(s)) {
        problems.push(`pattern ${p.id}: unknown stop ${s}`);
      }
    }
    for (let i = 1; i < p.offsets.length; i += 1) {
      if (p.offsets[i]! < p.offsets[i - 1]!) {
        problems.push(`pattern ${p.id}: offsets decrease at index ${i}`);
      }
    }
  }

  const patternStops = new Map(net.patterns.map((p) => [p.id, p.stops.length]));
  for (const t of net.trips) {
    if (!patternIds.has(t.pattern)) {
      problems.push(`trip: unknown pattern ${t.pattern}`);
    }
    if (!serviceIds.has(t.service)) {
      problems.push(`trip: unknown service ${t.service}`);
    }
    if (t.offsets && patternStops.get(t.pattern) !== t.offsets.length) {
      problems.push(`trip on ${t.pattern}: override offsets length ${t.offsets.length} != stops length`);
    }
  }

  for (const f of net.frequencies ?? []) {
    if (!patternIds.has(f.pattern)) {
      problems.push(`frequency: unknown pattern ${f.pattern}`);
    }
    if (!serviceIds.has(f.service)) {
      problems.push(`frequency: unknown service ${f.service}`);
    }
    if (f.to < f.from) {
      problems.push(`frequency on ${f.pattern}: to < from`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Neplatná síť (reference):\n${problems.join('\n')}`);
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/validate.test.ts`
Expected: 5 passing.

- [ ] **Step 8: Commit**

```bash
git add src/types schema src/data tests
git commit -m "feat: add network types, JSON schema, and validator"
```

---

### Task 3: Calendar resolution

**Files:**
- Create: `src/domain/calendar.ts`
- Test: `tests/calendar.test.ts`

**Interfaces:**
- Consumes: `Service` from `src/types/network`; `tinyNetwork` fixture.
- Produces:
  - `weekdayIndex(date: string): number` — 0 = Monday.
  - `previousDate(date: string): string`
  - `servicesOnDate(services: Iterable<Service>, date: string): Set<string>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/calendar.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/calendar.test.ts`
Expected: FAIL — cannot resolve `../src/domain/calendar`.

- [ ] **Step 3: Write the implementation**

Dates are handled in UTC throughout. A local-time `Date` would shift the weekday for anyone east or west of the machine's zone, and the calendar has no time-of-day component to lose.

```ts
// src/domain/calendar.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/calendar.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add src/domain/calendar.ts tests/calendar.test.ts
git commit -m "feat: resolve which services run on a given date"
```

---

### Task 4: Network index and frequency expansion

**Files:**
- Create: `src/data/expandFrequencies.ts`, `src/data/buildIndex.ts`
- Test: `tests/buildIndex.test.ts`

**Interfaces:**
- Consumes: `Network`, `Trip`, `Pattern`, `Stop`, `Line`, `Service`.
- Produces:
  - `expandFrequencies(net: Network): Trip[]` — the explicit trips plus every trip implied by frequency blocks.
  - `NetworkIndex` interface and `buildIndex(net: Network): NetworkIndex`.

```ts
export interface StopPosition { pattern: Pattern; index: number }

export interface NetworkIndex {
  network: Network;
  stops: Map<string, Stop>;
  lines: Map<string, Line>;
  patterns: Map<string, Pattern>;
  services: Service[];
  tripsByPattern: Map<string, Trip[]>;
  /** One entry per occurrence — a looping pattern lists the same stop twice. */
  patternsByStop: Map<string, StopPosition[]>;
  linesByStop: Map<string, Line[]>;
}
```

- [ ] **Step 1: Write the failing test**

```ts
// tests/buildIndex.test.ts
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../src/data/buildIndex';
import { expandFrequencies } from '../src/data/expandFrequencies';
import { tinyNetwork } from './fixtures/tinyNetwork';
import type { Network } from '../src/types/network';

describe('expandFrequencies', () => {
  it('returns explicit trips unchanged when there are no frequency blocks', () => {
    expect(expandFrequencies(tinyNetwork)).toHaveLength(3);
  });

  it('expands a headway block inclusively of both ends', () => {
    const net: Network = {
      ...structuredClone(tinyNetwork),
      trips: [],
      frequencies: [{ pattern: '563-0-1', service: 'weekday', from: 300, to: 360, headway: 20 }],
    };
    expect(expandFrequencies(net).map((t) => t.start)).toEqual([300, 320, 340, 360]);
  });

  it('throws on a non-positive headway rather than looping forever', () => {
    const net: Network = {
      ...structuredClone(tinyNetwork),
      frequencies: [{ pattern: '563-0-1', service: 'weekday', from: 300, to: 360, headway: 0 }],
    };
    expect(() => expandFrequencies(net)).toThrow(/headway/i);
  });
});

describe('buildIndex', () => {
  const index = buildIndex(tinyNetwork);

  it('indexes each stop position within its pattern', () => {
    expect(index.patternsByStop.get('b')).toEqual([
      { pattern: tinyNetwork.patterns[0], index: 1 },
    ]);
  });

  it('records every occurrence of a stop that appears twice in one pattern', () => {
    const looped = structuredClone(tinyNetwork);
    looped.patterns[0]!.stops = ['a', 'b', 'a'];
    looped.patterns[0]!.offsets = [0, 4, 9];
    expect(buildIndex(looped).patternsByStop.get('a')?.map((p) => p.index)).toEqual([0, 2]);
  });

  it('groups trips by pattern', () => {
    expect(index.tripsByPattern.get('563-0-1')).toHaveLength(3);
  });

  it('lists lines serving a stop, without duplicates', () => {
    expect(index.linesByStop.get('a')?.map((l) => l.id)).toEqual(['563']);
  });

  it('includes frequency-expanded trips', () => {
    const net: Network = {
      ...structuredClone(tinyNetwork),
      trips: [],
      frequencies: [{ pattern: '563-0-1', service: 'weekday', from: 300, to: 360, headway: 20 }],
    };
    expect(buildIndex(net).tripsByPattern.get('563-0-1')).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/buildIndex.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/data/expandFrequencies.ts
import type { Network, Trip } from '../types/network';

export function expandFrequencies(net: Network): Trip[] {
  const trips = [...net.trips];
  for (const block of net.frequencies ?? []) {
    if (block.headway <= 0) {
      throw new Error(`Frequency block on ${block.pattern} has non-positive headway ${block.headway}`);
    }
    for (let start = block.from; start <= block.to; start += block.headway) {
      trips.push({ pattern: block.pattern, service: block.service, start });
    }
  }
  return trips;
}
```

```ts
// src/data/buildIndex.ts
import type { Line, Network, Pattern, Service, Stop, Trip } from '../types/network';
import { expandFrequencies } from './expandFrequencies';

export interface StopPosition {
  pattern: Pattern;
  index: number;
}

export interface NetworkIndex {
  network: Network;
  stops: Map<string, Stop>;
  lines: Map<string, Line>;
  patterns: Map<string, Pattern>;
  services: Service[];
  tripsByPattern: Map<string, Trip[]>;
  patternsByStop: Map<string, StopPosition[]>;
  linesByStop: Map<string, Line[]>;
}

export function buildIndex(net: Network): NetworkIndex {
  const stops = new Map(net.stops.map((s) => [s.id, s]));
  const lines = new Map(net.lines.map((l) => [l.id, l]));
  const patterns = new Map(net.patterns.map((p) => [p.id, p]));

  const tripsByPattern = new Map<string, Trip[]>();
  for (const trip of expandFrequencies(net)) {
    const list = tripsByPattern.get(trip.pattern);
    if (list) {
      list.push(trip);
    } else {
      tripsByPattern.set(trip.pattern, [trip]);
    }
  }

  const patternsByStop = new Map<string, StopPosition[]>();
  const lineIdsByStop = new Map<string, Set<string>>();
  for (const pattern of net.patterns) {
    pattern.stops.forEach((stopId, index) => {
      const list = patternsByStop.get(stopId);
      if (list) {
        list.push({ pattern, index });
      } else {
        patternsByStop.set(stopId, [{ pattern, index }]);
      }

      const seen = lineIdsByStop.get(stopId);
      if (seen) {
        seen.add(pattern.line);
      } else {
        lineIdsByStop.set(stopId, new Set([pattern.line]));
      }
    });
  }

  const linesByStop = new Map<string, Line[]>();
  for (const [stopId, ids] of lineIdsByStop) {
    const list = [...ids]
      .map((id) => lines.get(id))
      .filter((l): l is Line => l !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name, 'cs', { numeric: true }));
    linesByStop.set(stopId, list);
  }

  return { network: net, stops, lines, patterns, services: net.services, tripsByPattern, patternsByStop, linesByStop };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/buildIndex.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add src/data tests/buildIndex.test.ts
git commit -m "feat: build lookup indexes and expand frequency blocks"
```

---

### Task 5: Departure board query

The post-midnight case is the whole reason this task exists. GTFS encodes a 00:20 departure as minute 1460 of the *previous* service day, so a query that only looks at today silently loses the night bus.

**Files:**
- Create: `src/domain/departures.ts`, `src/domain/formatMinutes.ts`
- Test: `tests/departures.test.ts`, `tests/formatMinutes.test.ts`

**Interfaces:**
- Consumes: `NetworkIndex` from Task 4; `servicesOnDate`, `previousDate` from Task 3.
- Produces:
  - `Departure` interface.
  - `departuresAt(index: NetworkIndex, stopId: string, date: string, fromMinutes: number, limit?: number): Departure[]`
  - `src/domain/formatMinutes.ts`: `formatMinutes(minutes: number): string` — `"06:14"`, wrapping values ≥ 1440.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/formatMinutes.test.ts
import { describe, expect, it } from 'vitest';
import { formatMinutes } from '../src/domain/formatMinutes';

describe('formatMinutes', () => {
  it('formats a normal time', () => {
    expect(formatMinutes(374)).toBe('06:14');
  });

  it('wraps a time past midnight', () => {
    expect(formatMinutes(1460)).toBe('00:20');
  });
});
```

```ts
// tests/departures.test.ts
import { describe, expect, it } from 'vitest';
import { buildIndex } from '../src/data/buildIndex';
import { departuresAt } from '../src/domain/departures';
import { tinyNetwork } from './fixtures/tinyNetwork';

const index = buildIndex(tinyNetwork);

describe('departuresAt', () => {
  it('returns the weekday departure from the first stop', () => {
    // Wednesday. Trip starts at 374, stop 'a' has offset 0. The 1450 trip
    // departs after midnight and so belongs to the next date's board.
    const found = departuresAt(index, 'a', '2026-09-02', 0);
    expect(found.map((d) => d.time)).toEqual([374]);
  });

  it('applies the pattern offset at a later stop', () => {
    // Stop 'c' has pattern offset 9, so 374 + 9 = 383.
    const found = departuresAt(index, 'c', '2026-09-02', 0);
    expect(found.map((d) => d.time)).toEqual([383]);
  });

  it('filters out departures before the requested time', () => {
    expect(departuresAt(index, 'a', '2026-09-02', 300).map((d) => d.time)).toEqual([374]);
    expect(departuresAt(index, 'a', '2026-09-02', 400)).toEqual([]);
  });

  it('finds a post-midnight departure belonging to the previous service day', () => {
    // Thursday 2026-09-03 is removed from the weekday service, so nothing runs
    // that day. But Wednesday's 1450 trip departs at 00:10 on Thursday morning.
    const found = departuresAt(index, 'a', '2026-09-03', 0);
    expect(found).toHaveLength(1);
    expect(found[0]!.time).toBe(10);
    expect(found[0]!.serviceDate).toBe('2026-09-02');
  });

  it('returns nothing when no service runs and no night trip spills over', () => {
    expect(departuresAt(index, 'a', '2026-09-03', 60)).toEqual([]);
  });

  it('honours the limit and returns results in time order', () => {
    const found = departuresAt(index, 'a', '2026-09-05', 0, 1);
    expect(found).toHaveLength(1);
    expect(found[0]!.time).toBe(374);
  });

  it('returns an empty array for an unknown stop', () => {
    expect(departuresAt(index, 'nope', '2026-09-02', 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/departures.test.ts`
Expected: FAIL — cannot resolve `../src/domain/departures`.

- [ ] **Step 3: Write the implementation**

```ts
// src/domain/formatMinutes.ts
export function formatMinutes(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
```

```ts
// src/domain/departures.ts
import type { NetworkIndex } from '../data/buildIndex';
import { previousDate, servicesOnDate } from './calendar';

export interface Departure {
  patternId: string;
  lineId: string;
  lineName: string;
  headsign: string;
  /** Minutes from midnight of the queried date. Always < 1440. */
  time: number;
  /** The service day the trip belongs to, which may be the previous date. */
  serviceDate: string;
}

/**
 * Departures from `stopId` at or after `fromMinutes` on `date`.
 *
 * Two service days are considered. A trip on the previous service day with a
 * time of 1460 departs at 00:20 on `date`, so its time is shifted by -1440.
 * Trips on the previous day that ran before midnight land on negative times
 * and fall out of the `time < fromMinutes` filter.
 */
export function departuresAt(
  index: NetworkIndex,
  stopId: string,
  date: string,
  fromMinutes: number,
  limit = 12,
): Departure[] {
  const positions = index.patternsByStop.get(stopId);
  if (!positions || positions.length === 0) {
    return [];
  }

  const days: Array<{ serviceDate: string; shift: number }> = [
    { serviceDate: previousDate(date), shift: 1440 },
    { serviceDate: date, shift: 0 },
  ];

  const found: Departure[] = [];
  for (const { serviceDate, shift } of days) {
    const active = servicesOnDate(index.services, serviceDate);
    if (active.size === 0) {
      continue;
    }

    for (const { pattern, index: stopIndex } of positions) {
      const line = index.lines.get(pattern.line);
      if (!line) {
        continue;
      }
      const trips = index.tripsByPattern.get(pattern.id) ?? [];

      for (const trip of trips) {
        if (!active.has(trip.service)) {
          continue;
        }
        const offsets = trip.offsets ?? pattern.offsets;
        const offset = offsets[stopIndex];
        if (offset === undefined) {
          continue;
        }
        const time = trip.start + offset - shift;
        if (time < fromMinutes || time >= 1440) {
          continue;
        }
        found.push({
          patternId: pattern.id,
          lineId: line.id,
          lineName: line.name,
          headsign: pattern.headsign,
          time,
          serviceDate,
        });
      }
    }
  }

  found.sort((a, b) => a.time - b.time);
  return found.slice(0, limit);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/departures.test.ts tests/formatMinutes.test.ts`
Expected: `tests/departures.test.ts` 7 passing, `tests/formatMinutes.test.ts` 2 passing.

Note the `time >= 1440` guard: a departure later than the queried date's midnight belongs to the *next* date's board, not this one. Without it the 1450 trip would appear both as "1450" today and "10" tomorrow.

- [ ] **Step 5: Commit**

```bash
git add src/domain/departures.ts src/domain/formatMinutes.ts tests/departures.test.ts tests/formatMinutes.test.ts
git commit -m "feat: query departures at a stop, including post-midnight trips"
```

---

### Task 6: GTFS reader

The IO shell of the converter. Kept separate from every pure transform so that later tasks can be tested without a zip file.

**Files:**
- Create: `scripts/gtfs/read.ts`, `config/scope.json`
- Test: `tests/gtfsRead.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ScopeConfig` interface and `loadScope(path?: string): ScopeConfig`
  - `downloadFeed(url: string, destDir: string): Promise<{ zipPath: string; feedDate: string }>`
  - `extractEntries(zipPath: string, destDir: string, names: string[]): Promise<void>`
  - `streamCsv<T>(path: string, onRow: (row: T) => void): Promise<void>`

- [ ] **Step 1: Install dependencies**

```bash
npm install -D yauzl @types/yauzl csv-parse
```

- [ ] **Step 2: Write the scope config**

The bbox covers every route that touches Břeclav, including the trains that reach Brno, Znojmo and Staré Město.

```json
// config/scope.json
{
  "feedUrl": "https://kordis-jmk.cz/gtfs/gtfs.zip",
  "municipality": "Břeclav",
  "bbox": { "minLat": 48.55, "minLon": 15.95, "maxLat": 49.35, "maxLon": 17.65 },
  "overpassUrl": "https://overpass-api.de/api/interpreter",
  "osmNetwork": "IDS JMK",
  "expectedRoutes": { "min": 15, "max": 30 }
}
```

- [ ] **Step 3: Write the failing test**

Only `streamCsv` and `loadScope` are unit-testable without network access; the download is exercised for real in Task 12.

```ts
// tests/gtfsRead.test.ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadScope, streamCsv } from '../scripts/gtfs/read';

describe('loadScope', () => {
  it('reads the municipality and feed url', () => {
    const scope = loadScope();
    expect(scope.municipality).toBe('Břeclav');
    expect(scope.feedUrl).toMatch(/^https:\/\//);
  });
});

describe('streamCsv', () => {
  it('parses rows and strips the UTF-8 BOM from the header', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gtfs-'));
    const file = join(dir, 'stops.txt');
    writeFileSync(file, '﻿stop_id,stop_name\nU1,"Břeclav, aut.nádr."\nU2,Poštorná\n', 'utf8');

    const rows: Record<string, string>[] = [];
    await streamCsv<Record<string, string>>(file, (row) => rows.push(row));

    expect(rows).toEqual([
      { stop_id: 'U1', stop_name: 'Břeclav, aut.nádr.' },
      { stop_id: 'U2', stop_name: 'Poštorná' },
    ]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/gtfsRead.test.ts`
Expected: FAIL — cannot resolve `../scripts/gtfs/read`.

- [ ] **Step 5: Write the implementation**

```ts
// scripts/gtfs/read.ts
import { createReadStream, createWriteStream, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { parse } from 'csv-parse';
import yauzl from 'yauzl';

export interface ScopeConfig {
  feedUrl: string;
  municipality: string;
  bbox: { minLat: number; minLon: number; maxLat: number; maxLon: number };
  overpassUrl: string;
  osmNetwork: string;
  expectedRoutes: { min: number; max: number };
}

export function loadScope(path = 'config/scope.json'): ScopeConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as ScopeConfig;
}

/**
 * Downloads the feed unless a local copy is already current. Returns the feed's
 * Last-Modified date, which becomes `meta.feedDate`.
 */
export async function downloadFeed(url: string, destDir: string): Promise<{ zipPath: string; feedDate: string }> {
  mkdirSync(destDir, { recursive: true });
  const zipPath = join(destDir, 'gtfs.zip');

  const head = await fetch(url, { method: 'HEAD' });
  if (!head.ok) {
    throw new Error(`HEAD ${url} failed: ${head.status}`);
  }
  const lastModified = head.headers.get('last-modified');
  const feedDate = lastModified ? new Date(lastModified).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

  let haveCurrent = false;
  try {
    const local = statSync(zipPath);
    haveCurrent = lastModified !== null && local.mtime >= new Date(lastModified);
  } catch {
    haveCurrent = false;
  }

  if (!haveCurrent) {
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      throw new Error(`GET ${url} failed: ${res.status}`);
    }
    await pipeline(res.body, createWriteStream(zipPath));
  }

  return { zipPath, feedDate };
}

/** Extracts the named entries to `destDir`, streaming rather than buffering. */
export function extractEntries(zipPath: string, destDir: string, names: string[]): Promise<void> {
  mkdirSync(destDir, { recursive: true });
  const wanted = new Set(names);

  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        return reject(err ?? new Error('cannot open zip'));
      }

      zip.on('error', reject);
      zip.on('end', resolve);
      zip.readEntry();

      zip.on('entry', (entry) => {
        if (!wanted.has(entry.fileName)) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            return reject(streamErr ?? new Error('cannot read entry'));
          }
          const out = join(destDir, entry.fileName);
          mkdirSync(dirname(out), { recursive: true });
          stream.pipe(createWriteStream(out)).on('close', () => zip.readEntry()).on('error', reject);
        });
      });
    });
  });
}

/** Streams a CSV file row by row. Never holds the whole file in memory. */
export async function streamCsv<T>(path: string, onRow: (row: T) => void): Promise<void> {
  const parser = createReadStream(path).pipe(parse({ columns: true, bom: true, skip_empty_lines: true }));
  for await (const row of parser) {
    onRow(row as T);
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/gtfsRead.test.ts`
Expected: 2 passing.

- [ ] **Step 7: Commit**

```bash
git add scripts/gtfs/read.ts config/scope.json tests/gtfsRead.test.ts
git commit -m "feat: add GTFS download, extraction, and streaming CSV reader"
```

---

### Task 7: Scope selection and parent-station collapse

**Files:**
- Create: `scripts/gtfs/scope.ts`
- Test: `tests/gtfsScope.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions over plain rows).
- Produces:
  - `municipalityOf(stopName: string): string`
  - `buildParentMap(rows: GtfsStopRow[]): Map<string, string>` — every stop id, platform or station, to its parent-station id.
  - `slugify(name: string): string`
  - `assignStopIds(stations: GtfsStopRow[]): Map<string, string>` — GTFS station id to readable slug, deduplicated.
  - Row interfaces `GtfsStopRow`, `GtfsTripRow`, `GtfsRouteRow`, `GtfsStopTimeRow`, `GtfsCalendarRow`, `GtfsCalendarDateRow`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/gtfsScope.test.ts
import { describe, expect, it } from 'vitest';
import { assignStopIds, buildParentMap, municipalityOf, slugify } from '../scripts/gtfs/scope';
import type { GtfsStopRow } from '../scripts/gtfs/scope';

const rows: GtfsStopRow[] = [
  { stop_id: 'U15729N402', stop_name: 'Břeclav, autobusové nádraží', stop_lat: '48.754552', stop_lon: '16.893169', zone_id: '', location_type: '1', parent_station: '', wheelchair_boarding: '1', platform_code: '' },
  { stop_id: 'U15729Z15', stop_name: 'Břeclav, autobusové nádraží', stop_lat: '48.753851', stop_lon: '16.893169', zone_id: '575', location_type: '0', parent_station: 'U15729N402', wheelchair_boarding: '1', platform_code: '' },
  { stop_id: 'U15729Z14', stop_name: 'Břeclav, autobusové nádraží', stop_lat: '48.753851', stop_lon: '16.893169', zone_id: '575', location_type: '0', parent_station: 'U15729N402', wheelchair_boarding: '1', platform_code: '' },
  { stop_id: 'U99N1', stop_name: 'Lednice, zámek', stop_lat: '48.801', stop_lon: '16.805', zone_id: '', location_type: '1', parent_station: '', wheelchair_boarding: '0', platform_code: '' },
];

describe('municipalityOf', () => {
  it('takes the part before the first comma', () => {
    expect(municipalityOf('Břeclav, autobusové nádraží')).toBe('Břeclav');
  });

  it('returns the whole name when there is no comma', () => {
    expect(municipalityOf('Břeclav')).toBe('Břeclav');
  });

  it('trims surrounding whitespace', () => {
    expect(municipalityOf(' Břeclav , Poštorná')).toBe('Břeclav');
  });
});

describe('buildParentMap', () => {
  it('maps a platform to its parent station', () => {
    expect(buildParentMap(rows).get('U15729Z15')).toBe('U15729N402');
  });

  it('maps a parentless stop to itself', () => {
    expect(buildParentMap(rows).get('U99N1')).toBe('U99N1');
  });
});

describe('slugify', () => {
  it('strips Czech diacritics and punctuation', () => {
    expect(slugify('Břeclav, aut.nádr.')).toBe('breclav-aut-nadr');
  });

  it('collapses runs of separators', () => {
    expect(slugify('Lednice  --  zámek')).toBe('lednice-zamek');
  });
});

describe('assignStopIds', () => {
  it('produces readable, unique ids', () => {
    const ids = assignStopIds(rows.filter((r) => r.location_type === '1'));
    expect(ids.get('U15729N402')).toBe('breclav-autobusove-nadrazi');
    expect(ids.get('U99N1')).toBe('lednice-zamek');
  });

  it('disambiguates colliding slugs deterministically', () => {
    const dupes: GtfsStopRow[] = [
      { ...rows[0]!, stop_id: 'B', stop_name: 'Břeclav, škola' },
      { ...rows[0]!, stop_id: 'A', stop_name: 'Břeclav, Škola' },
    ];
    const ids = assignStopIds(dupes);
    // Sorted by GTFS id, so 'A' claims the bare slug regardless of input order.
    expect(ids.get('A')).toBe('breclav-skola');
    expect(ids.get('B')).toBe('breclav-skola-2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/gtfsScope.test.ts`
Expected: FAIL — cannot resolve `../scripts/gtfs/scope`.

- [ ] **Step 3: Write the implementation**

```ts
// scripts/gtfs/scope.ts
export interface GtfsStopRow {
  stop_id: string;
  stop_name: string;
  stop_lat: string;
  stop_lon: string;
  zone_id: string;
  location_type: string;
  parent_station: string;
  wheelchair_boarding: string;
  platform_code: string;
}

export interface GtfsRouteRow {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  route_type: string;
  route_color: string;
  route_text_color: string;
}

export interface GtfsTripRow {
  route_id: string;
  service_id: string;
  trip_id: string;
  trip_headsign: string;
  direction_id: string;
}

export interface GtfsStopTimeRow {
  trip_id: string;
  stop_id: string;
  stop_sequence: string;
  arrival_time: string;
  departure_time: string;
}

export interface GtfsCalendarRow {
  service_id: string;
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  saturday: string;
  sunday: string;
  start_date: string;
  end_date: string;
}

export interface GtfsCalendarDateRow {
  service_id: string;
  date: string;
  exception_type: string;
}

export function municipalityOf(stopName: string): string {
  const [first] = stopName.split(',');
  return (first ?? '').trim();
}

/** Every stop id — platform or station — mapped to the station it belongs to. */
export function buildParentMap(rows: Iterable<GtfsStopRow>): Map<string, string> {
  const parents = new Map<string, string>();
  for (const row of rows) {
    parents.set(row.stop_id, row.parent_station || row.stop_id);
  }
  return parents;
}

export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Readable ids for stations. Sorted by GTFS id first so that a slug collision
 * always resolves the same way across runs.
 */
export function assignStopIds(stations: Iterable<GtfsStopRow>): Map<string, string> {
  const sorted = [...stations].sort((a, b) => a.stop_id.localeCompare(b.stop_id));
  const used = new Map<string, number>();
  const ids = new Map<string, string>();

  for (const station of sorted) {
    const base = slugify(station.stop_name) || 'stop';
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    ids.set(station.stop_id, seen === 0 ? base : `${base}-${seen + 1}`);
  }
  return ids;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/gtfsScope.test.ts`
Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add scripts/gtfs/scope.ts tests/gtfsScope.test.ts
git commit -m "feat: collapse platforms to parent stations and assign readable stop ids"
```

---

### Task 8: Pattern, line, and service conversion

**Files:**
- Create: `scripts/gtfs/convert.ts`
- Test: `tests/gtfsConvert.test.ts`

**Interfaces:**
- Consumes: row types and helpers from Task 7; `Network` types from Task 2.
- Produces:
  - `parseGtfsTime(value: string): number`
  - `assignLineIds(routes: GtfsRouteRow[]): Map<string, string>`
  - `buildLines(routes, lineIds): Line[]`
  - `buildServices(calendar: GtfsCalendarRow[], exceptions: GtfsCalendarDateRow[]): Service[]`
  - `TripShape` interface `{ tripId, routeId, directionId, headsign, serviceId, stops: string[], times: number[] }`
  - `buildPatternsAndTrips(shapes: TripShape[], lineIds: Map<string,string>): { patterns: Pattern[]; trips: Trip[] }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/gtfsConvert.test.ts
import { describe, expect, it } from 'vitest';
import {
  assignLineIds,
  buildPatternsAndTrips,
  buildServices,
  parseGtfsTime,
} from '../scripts/gtfs/convert';
import type { TripShape } from '../scripts/gtfs/convert';
import type { GtfsCalendarDateRow, GtfsCalendarRow, GtfsRouteRow } from '../scripts/gtfs/scope';

describe('parseGtfsTime', () => {
  it('parses a normal time to minutes', () => {
    expect(parseGtfsTime('06:14:00')).toBe(374);
  });

  it('keeps times past midnight above 1440', () => {
    expect(parseGtfsTime('25:10:00')).toBe(1510);
  });
});

describe('assignLineIds', () => {
  const routes: GtfsRouteRow[] = [
    { route_id: 'L563D99', route_short_name: '563', route_long_name: '', route_type: '3', route_color: '2C89C8', route_text_color: 'FFFFFF' },
    { route_id: 'L900D99', route_short_name: '563', route_long_name: '', route_type: '2', route_color: '800000', route_text_color: 'FFFFFF' },
    { route_id: 'L136D99', route_short_name: 'R50', route_long_name: '', route_type: '2', route_color: '800000', route_text_color: 'E1CB31' },
  ];

  it('uses the short name when it is unique', () => {
    expect(assignLineIds(routes).get('L136D99')).toBe('R50');
  });

  it('falls back to the route id when short names collide', () => {
    const ids = assignLineIds(routes);
    expect(ids.get('L563D99')).toBe('L563D99');
    expect(ids.get('L900D99')).toBe('L900D99');
  });
});

describe('buildServices', () => {
  const calendar: GtfsCalendarRow[] = [
    { service_id: '1', monday: '1', tuesday: '1', wednesday: '1', thursday: '1', friday: '1', saturday: '0', sunday: '0', start_date: '20260830', end_date: '20261212' },
  ];
  const exceptions: GtfsCalendarDateRow[] = [
    { service_id: '1', date: '20261117', exception_type: '2' },
    { service_id: '1', date: '20260905', exception_type: '1' },
    { service_id: '2', date: '20260906', exception_type: '1' },
  ];

  it('converts the day mask with Monday first', () => {
    expect(buildServices(calendar, exceptions)[0]!.days).toEqual([1, 1, 1, 1, 1, 0, 0]);
  });

  it('formats dates as ISO', () => {
    const service = buildServices(calendar, exceptions)[0]!;
    expect(service.from).toBe('2026-08-30');
    expect(service.to).toBe('2026-12-12');
  });

  it('splits exceptions into added and removed', () => {
    const service = buildServices(calendar, exceptions)[0]!;
    expect(service.added).toEqual(['2026-09-05']);
    expect(service.removed).toEqual(['2026-11-17']);
  });

  it('creates a service for an id that only appears in calendar_dates', () => {
    const only = buildServices(calendar, exceptions).find((s) => s.id === '2');
    expect(only).toBeDefined();
    expect(only!.days).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(only!.added).toEqual(['2026-09-06']);
  });
});

describe('buildPatternsAndTrips', () => {
  const lineIds = new Map([['L563D99', '563']]);

  const shape = (tripId: string, times: number[], stops = ['a', 'b', 'c']): TripShape => ({
    tripId,
    routeId: 'L563D99',
    directionId: 0,
    headsign: 'FOSFA',
    serviceId: '1',
    stops,
    times,
  });

  it('groups trips sharing a stop sequence into one pattern', () => {
    const { patterns } = buildPatternsAndTrips(
      [shape('t1', [360, 364, 369]), shape('t2', [420, 424, 429])],
      lineIds,
    );
    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.stops).toEqual(['a', 'b', 'c']);
    expect(patterns[0]!.offsets).toEqual([0, 4, 9]);
  });

  it('separates patterns that differ in stop sequence', () => {
    const { patterns } = buildPatternsAndTrips(
      [shape('t1', [360, 364, 369]), shape('t2', [420, 424], ['a', 'b'])],
      lineIds,
    );
    expect(patterns).toHaveLength(2);
    expect(patterns.map((p) => p.id)).toEqual(['563-0-1', '563-0-2']);
  });

  it('uses the modal run times for the pattern and overrides the minority', () => {
    const { patterns, trips } = buildPatternsAndTrips(
      [shape('t1', [360, 364, 369]), shape('t2', [420, 424, 429]), shape('t3', [480, 483, 487])],
      lineIds,
    );
    expect(patterns[0]!.offsets).toEqual([0, 4, 9]);
    const overrides = trips.filter((t) => t.offsets !== undefined);
    expect(overrides).toHaveLength(1);
    expect(overrides[0]!.offsets).toEqual([0, 3, 7]);
    expect(overrides[0]!.start).toBe(480);
  });

  it('records each trip start as the first stop time', () => {
    const { trips } = buildPatternsAndTrips([shape('t1', [360, 364, 369])], lineIds);
    expect(trips[0]!.start).toBe(360);
    expect(trips[0]!.service).toBe('1');
  });

  it('sorts trips deterministically by pattern then start', () => {
    const { trips } = buildPatternsAndTrips(
      [shape('t2', [420, 424, 429]), shape('t1', [360, 364, 369])],
      lineIds,
    );
    expect(trips.map((t) => t.start)).toEqual([360, 420]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/gtfsConvert.test.ts`
Expected: FAIL — cannot resolve `../scripts/gtfs/convert`.

- [ ] **Step 3: Write the implementation**

```ts
// scripts/gtfs/convert.ts
import type { DayMask, Line, Mode, Pattern, Service, Trip } from '../../src/types/network';
import type { GtfsCalendarDateRow, GtfsCalendarRow, GtfsRouteRow } from './scope';

export interface TripShape {
  tripId: string;
  routeId: string;
  directionId: 0 | 1;
  headsign: string;
  serviceId: string;
  /** Parent-station ids, in travel order. */
  stops: string[];
  /** Departure minutes, same length and order as `stops`. May exceed 1440. */
  times: number[];
}

/** GTFS times may exceed 24 hours; 25:10:00 means 01:10 the next morning. */
export function parseGtfsTime(value: string): number {
  const [h, m] = value.split(':');
  return Number(h) * 60 + Number(m);
}

function isoDate(yyyymmdd: string): string {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

export function assignLineIds(routes: Iterable<GtfsRouteRow>): Map<string, string> {
  const all = [...routes].sort((a, b) => a.route_id.localeCompare(b.route_id));
  const counts = new Map<string, number>();
  for (const r of all) {
    counts.set(r.route_short_name, (counts.get(r.route_short_name) ?? 0) + 1);
  }

  const ids = new Map<string, string>();
  for (const r of all) {
    const unique = counts.get(r.route_short_name) === 1 && r.route_short_name.length > 0;
    ids.set(r.route_id, unique ? r.route_short_name : r.route_id);
  }
  return ids;
}

function modeOf(routeType: string): Mode {
  // GTFS route_type 2 is rail; everything the IDS JMK feed carries otherwise is road.
  return routeType === '2' ? 'rail' : 'bus';
}

function hexColor(value: string, fallback: string): string {
  return /^[0-9A-Fa-f]{6}$/.test(value) ? `#${value.toUpperCase()}` : fallback;
}

export function buildLines(routes: Iterable<GtfsRouteRow>, lineIds: Map<string, string>): Line[] {
  return [...routes]
    .map((r) => ({
      id: lineIds.get(r.route_id) ?? r.route_id,
      name: r.route_short_name || r.route_id,
      longName: r.route_long_name,
      mode: modeOf(r.route_type),
      color: hexColor(r.route_color, '#666666'),
      textColor: hexColor(r.route_text_color, '#FFFFFF'),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'cs', { numeric: true }));
}

export function buildServices(
  calendar: Iterable<GtfsCalendarRow>,
  exceptions: Iterable<GtfsCalendarDateRow>,
): Service[] {
  const byId = new Map<string, Service>();

  for (const row of calendar) {
    byId.set(row.service_id, {
      id: row.service_id,
      days: [row.monday, row.tuesday, row.wednesday, row.thursday, row.friday, row.saturday, row.sunday]
        .map(Number) as DayMask,
      from: isoDate(row.start_date),
      to: isoDate(row.end_date),
    });
  }

  for (const row of exceptions) {
    let service = byId.get(row.service_id);
    if (!service) {
      // calendar_dates.txt may carry service ids absent from calendar.txt.
      service = { id: row.service_id, days: [0, 0, 0, 0, 0, 0, 0], from: isoDate(row.date), to: isoDate(row.date) };
      byId.set(row.service_id, service);
    }
    const date = isoDate(row.date);
    if (row.exception_type === '1') {
      (service.added ??= []).push(date);
    } else {
      (service.removed ??= []).push(date);
    }
    if (date < service.from) {
      service.from = date;
    }
    if (date > service.to) {
      service.to = date;
    }
  }

  return [...byId.values()]
    .map((s) => ({ ...s, added: s.added?.sort(), removed: s.removed?.sort() }))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/**
 * Groups trips into patterns by (line, direction, stop sequence). Each pattern
 * takes its group's most common run-time vector; trips that differ carry their
 * own. On the real feed roughly 38% of trips carry an override, so this is a
 * normal path, not a rare one.
 */
export function buildPatternsAndTrips(
  shapes: Iterable<TripShape>,
  lineIds: Map<string, string>,
): { patterns: Pattern[]; trips: Trip[] } {
  interface Entry {
    start: number;
    offsets: number[];
    service: string;
  }

  interface Group {
    lineId: string;
    direction: 0 | 1;
    headsign: string;
    stops: string[];
    entries: Entry[];
  }

  const groups = new Map<string, Group>();

  for (const shape of shapes) {
    const lineId = lineIds.get(shape.routeId) ?? shape.routeId;
    const key = `${lineId}|${shape.directionId}|${shape.stops.join('>')}`;
    const start = shape.times[0]!;
    const offsets = shape.times.map((t) => t - start);

    const entry: Entry = { start, offsets, service: shape.serviceId };
    const group = groups.get(key);
    if (group) {
      group.entries.push(entry);
    } else {
      groups.set(key, {
        lineId,
        direction: shape.directionId,
        headsign: shape.headsign,
        stops: shape.stops,
        entries: [entry],
      });
    }
  }

  // Sorting the group keys makes pattern numbering stable across runs.
  const ordered = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  const counters = new Map<string, number>();
  const patterns: Pattern[] = [];
  const trips: Trip[] = [];

  for (const [, group] of ordered) {
    const prefix = `${group.lineId}-${group.direction}`;
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    const patternId = `${prefix}-${n}`;

    const tally = new Map<string, number>();
    for (const entry of group.entries) {
      const k = entry.offsets.join(',');
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    const modalKey = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
    const modal = modalKey.split(',').map(Number);

    patterns.push({
      id: patternId,
      line: group.lineId,
      direction: group.direction,
      headsign: group.headsign,
      stops: group.stops,
      offsets: modal,
    });

    const sorted = group.entries.sort((a, b) => a.start - b.start || a.service.localeCompare(b.service));
    for (const entry of sorted) {
      const same = entry.offsets.join(',') === modalKey;
      trips.push(
        same
          ? { pattern: patternId, service: entry.service, start: entry.start }
          : { pattern: patternId, service: entry.service, start: entry.start, offsets: entry.offsets },
      );
    }
  }

  return { patterns, trips };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/gtfsConvert.test.ts`
Expected: 13 passing.

- [ ] **Step 5: Commit**

```bash
git add scripts/gtfs/convert.ts tests/gtfsConvert.test.ts
git commit -m "feat: convert GTFS routes, calendars, and trips into patterns"
```

---

### Task 9: Overpass client with committed cache

**Files:**
- Create: `scripts/osm/overpass.ts`
- Test: `tests/overpass.test.ts`

**Interfaces:**
- Consumes: `ScopeConfig` from Task 6.
- Produces:
  - `OsmElement`, `OsmResponse`, `OsmRelation`, `OsmWay` interfaces.
  - `buildQuery(scope: ScopeConfig): string`
  - `fetchRoutes(scope: ScopeConfig, opts?: { refresh?: boolean; cacheDir?: string }): Promise<OsmResponse>`

- [ ] **Step 1: Write the failing test**

The network call is not tested; the query text and the cache behaviour are.

```ts
// tests/overpass.test.ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildQuery, fetchRoutes } from '../scripts/osm/overpass';
import { loadScope } from '../scripts/gtfs/read';

const scope = loadScope();

describe('buildQuery', () => {
  const query = buildQuery(scope);

  it('filters to route relations in the configured network', () => {
    expect(query).toContain('"type"="route"');
    expect(query).toContain('"network"~"IDS JMK"');
  });

  it('bounds the query by the configured bbox', () => {
    expect(query).toContain('48.55,15.95,49.35,17.65');
  });

  it('requests way geometry, not just relation membership', () => {
    expect(query).toContain('out body');
    expect(query).toContain('>;');
  });
});

describe('fetchRoutes', () => {
  it('reads the cache without hitting the network', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'osm-'));
    const cached = { version: 0.6, generator: 'test', elements: [] };
    writeFileSync(join(cacheDir, 'routes.json'), JSON.stringify(cached), 'utf8');

    const result = await fetchRoutes(scope, { cacheDir });
    expect(result.elements).toEqual([]);
  });

  it('leaves the cache file untouched when it already exists', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'osm-'));
    const path = join(cacheDir, 'routes.json');
    writeFileSync(path, JSON.stringify({ version: 0.6, generator: 'x', elements: [] }), 'utf8');
    const before = readFileSync(path, 'utf8');

    await fetchRoutes(scope, { cacheDir });
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/overpass.test.ts`
Expected: FAIL — cannot resolve `../scripts/osm/overpass`.

- [ ] **Step 3: Write the implementation**

One query fetches every IDS JMK route relation in the bbox. Matching to lines happens in memory afterwards, so Overpass is hit once rather than twenty times.

```ts
// scripts/osm/overpass.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScopeConfig } from '../gtfs/read';

export interface OsmNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
}

export interface OsmWay {
  type: 'way';
  id: number;
  nodes: number[];
}

export interface OsmRelation {
  type: 'relation';
  id: number;
  tags: Record<string, string>;
  members: Array<{ type: string; ref: number; role: string }>;
}

export type OsmElement = OsmNode | OsmWay | OsmRelation;

export interface OsmResponse {
  version: number;
  generator: string;
  elements: OsmElement[];
}

export function buildQuery(scope: ScopeConfig): string {
  const { minLat, minLon, maxLat, maxLon } = scope.bbox;
  const bbox = `${minLat},${minLon},${maxLat},${maxLon}`;
  return [
    '[out:json][timeout:300];',
    `relation["type"="route"]["network"~"${scope.osmNetwork}"](${bbox});`,
    'out body;',
    '>;',
    'out skel qt;',
  ].join('\n');
}

/**
 * Returns every IDS JMK route relation in the bbox, from the committed cache
 * when present. Overpass is slow and rate-limited, so a cache miss is the
 * exception and `refresh` must be asked for explicitly.
 */
export async function fetchRoutes(
  scope: ScopeConfig,
  opts: { refresh?: boolean; cacheDir?: string } = {},
): Promise<OsmResponse> {
  const cacheDir = opts.cacheDir ?? 'data/cache/osm';
  const cachePath = join(cacheDir, 'routes.json');

  if (!opts.refresh && existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf8')) as OsmResponse;
  }

  const res = await fetch(scope.overpassUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: buildQuery(scope) }),
  });
  if (!res.ok) {
    throw new Error(`Overpass failed: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as OsmResponse;
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cachePath, `${JSON.stringify(body)}\n`, 'utf8');
  return body;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/overpass.test.ts`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add scripts/osm/overpass.ts tests/overpass.test.ts
git commit -m "feat: query OSM route relations via Overpass with a committed cache"
```

---

### Task 10: Relation way stitching

An OSM route relation lists its ways in arbitrary order and arbitrary orientation. Turning that into one ordered polyline is the piece most likely to be got subtly wrong, so it is isolated and tested on its own.

**Files:**
- Create: `scripts/osm/stitch.ts`
- Test: `tests/stitch.test.ts`

**Interfaces:**
- Consumes: `OsmWay`, `OsmNode` from Task 9.
- Produces:
  - `stitchWays(ways: number[][]): number[][]` — node-id chains, longest first.
  - `relationToLine(relation, ways, nodes): [number, number][]` — the longest chain as `[lon, lat]` positions.

- [ ] **Step 1: Write the failing test**

```ts
// tests/stitch.test.ts
import { describe, expect, it } from 'vitest';
import { relationToLine, stitchWays } from '../scripts/osm/stitch';
import type { OsmNode, OsmRelation, OsmWay } from '../scripts/osm/overpass';

describe('stitchWays', () => {
  it('joins ways given in order', () => {
    expect(stitchWays([[1, 2, 3], [3, 4, 5]])).toEqual([[1, 2, 3, 4, 5]]);
  });

  it('joins ways given out of order', () => {
    expect(stitchWays([[3, 4, 5], [1, 2, 3]])).toEqual([[1, 2, 3, 4, 5]]);
  });

  it('reverses a way whose orientation is flipped', () => {
    expect(stitchWays([[1, 2, 3], [5, 4, 3]])).toEqual([[1, 2, 3, 4, 5]]);
  });

  it('joins ways that meet at the first way's start', () => {
    // Chain orientation is arbitrary — trimToStops resolves direction later by
    // trying the line both ways round — so this is the same path, reversed.
    expect(stitchWays([[3, 2, 1], [3, 4, 5]])).toEqual([[5, 4, 3, 2, 1]]);
  });

  it('returns disconnected groups as separate chains, longest first', () => {
    expect(stitchWays([[1, 2], [10, 11, 12, 13]])).toEqual([[10, 11, 12, 13], [1, 2]]);
  });

  it('returns an empty array for no ways', () => {
    expect(stitchWays([])).toEqual([]);
  });
});

describe('relationToLine', () => {
  it('resolves the longest chain to lon/lat positions', () => {
    const relation: OsmRelation = {
      type: 'relation',
      id: 1,
      tags: { ref: '563' },
      members: [
        { type: 'way', ref: 100, role: '' },
        { type: 'way', ref: 101, role: '' },
        { type: 'node', ref: 1, role: 'stop' },
      ],
    };
    const ways: OsmWay[] = [
      { type: 'way', id: 101, nodes: [3, 4] },
      { type: 'way', id: 100, nodes: [1, 2, 3] },
    ];
    const nodes: OsmNode[] = [
      { type: 'node', id: 1, lat: 48.75, lon: 16.88 },
      { type: 'node', id: 2, lat: 48.76, lon: 16.89 },
      { type: 'node', id: 3, lat: 48.77, lon: 16.9 },
      { type: 'node', id: 4, lat: 48.78, lon: 16.91 },
    ];

    expect(relationToLine(relation, ways, nodes)).toEqual([
      [16.88, 48.75],
      [16.89, 48.76],
      [16.9, 48.77],
      [16.91, 48.78],
    ]);
  });

  it('ignores members with a role, which are stops rather than the path', () => {
    const relation: OsmRelation = {
      type: 'relation',
      id: 1,
      tags: {},
      members: [
        { type: 'way', ref: 100, role: '' },
        { type: 'way', ref: 999, role: 'platform' },
      ],
    };
    const ways: OsmWay[] = [
      { type: 'way', id: 100, nodes: [1, 2] },
      { type: 'way', id: 999, nodes: [50, 51] },
    ];
    const nodes: OsmNode[] = [
      { type: 'node', id: 1, lat: 1, lon: 1 },
      { type: 'node', id: 2, lat: 2, lon: 2 },
      { type: 'node', id: 50, lat: 9, lon: 9 },
      { type: 'node', id: 51, lat: 9, lon: 9 },
    ];

    expect(relationToLine(relation, ways, nodes)).toEqual([[1, 1], [2, 2]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stitch.test.ts`
Expected: FAIL — cannot resolve `../scripts/osm/stitch`.

- [ ] **Step 3: Write the implementation**

```ts
// scripts/osm/stitch.ts
import type { OsmNode, OsmRelation, OsmWay } from './overpass';

/**
 * Chains ways end to end. Ways arrive unordered and may need reversing. A route
 * with a gap yields more than one chain, returned longest first.
 */
export function stitchWays(ways: number[][]): number[][] {
  const remaining = ways.filter((w) => w.length >= 2).map((w) => [...w]);
  const chains: number[][] = [];

  while (remaining.length > 0) {
    const chain = remaining.shift()!;
    let extended = true;

    while (extended) {
      extended = false;
      for (let i = 0; i < remaining.length; i += 1) {
        const way = remaining[i]!;
        const head = chain[0]!;
        const tail = chain[chain.length - 1]!;

        if (way[0] === tail) {
          chain.push(...way.slice(1));
        } else if (way[way.length - 1] === tail) {
          chain.push(...[...way].reverse().slice(1));
        } else if (way[way.length - 1] === head) {
          chain.unshift(...way.slice(0, -1));
        } else if (way[0] === head) {
          chain.unshift(...[...way].reverse().slice(0, -1));
        } else {
          continue;
        }

        remaining.splice(i, 1);
        extended = true;
        break;
      }
    }
    chains.push(chain);
  }

  return chains.sort((a, b) => b.length - a.length);
}

/** The relation's longest continuous chain, as [lon, lat] positions. */
export function relationToLine(
  relation: OsmRelation,
  ways: Iterable<OsmWay>,
  nodes: Iterable<OsmNode>,
): [number, number][] {
  const wayById = new Map<number, OsmWay>();
  for (const w of ways) {
    wayById.set(w.id, w);
  }
  const nodeById = new Map<number, OsmNode>();
  for (const n of nodes) {
    nodeById.set(n.id, n);
  }

  // Members with a role are stops and platforms; only roleless ways form the path.
  const path = relation.members
    .filter((m) => m.type === 'way' && m.role === '')
    .map((m) => wayById.get(m.ref))
    .filter((w): w is OsmWay => w !== undefined)
    .map((w) => w.nodes);

  const [longest] = stitchWays(path);
  if (!longest) {
    return [];
  }

  return longest
    .map((id) => nodeById.get(id))
    .filter((n): n is OsmNode => n !== undefined)
    .map((n) => [n.lon, n.lat] as [number, number]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/stitch.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add scripts/osm/stitch.ts tests/stitch.test.ts
git commit -m "feat: stitch OSM relation ways into ordered polylines"
```

---

### Task 11: Pattern geometry matching

**Files:**
- Create: `scripts/osm/match.ts`
- Test: `tests/match.test.ts`

**Interfaces:**
- Consumes: `relationToLine` (Task 10), `OsmResponse` (Task 9), `Pattern`/`Stop` (Task 2).
- Produces:
  - `GeometrySource = 'override' | 'osm' | 'straight'`
  - `straightLine(pattern, stops): [number, number][]`
  - `trimToStops(line, coords, maxSnapMetres): [number, number][] | null` — `null` when the stops do not lie along the line in order.
  - `matchPatternGeometry(args): { coordinates: [number,number][]; source: GeometrySource }`

- [ ] **Step 1: Install Turf**

```bash
npm install -D @turf/helpers @turf/nearest-point-on-line @turf/line-slice @turf/distance
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/match.test.ts
import { describe, expect, it } from 'vitest';
import { matchPatternGeometry, straightLine, trimToStops } from '../scripts/osm/match';
import type { Pattern, Stop } from '../src/types/network';

const stops: Stop[] = [
  { id: 'a', name: 'A', lat: 48.70, lon: 16.80 },
  { id: 'b', name: 'B', lat: 48.75, lon: 16.80 },
  { id: 'c', name: 'C', lat: 48.80, lon: 16.80 },
];
const stopById = new Map(stops.map((s) => [s.id, s]));

const pattern: Pattern = {
  id: '563-0-1', line: '563', direction: 0, headsign: 'C',
  stops: ['a', 'b', 'c'], offsets: [0, 5, 10],
};

// A straight north-south line running past all three stops, and beyond them.
const corridor: [number, number][] = [
  [16.80, 48.60], [16.80, 48.70], [16.80, 48.75], [16.80, 48.80], [16.80, 48.90],
];

describe('straightLine', () => {
  it('connects the pattern stops in order', () => {
    expect(straightLine(pattern, stopById)).toEqual([[16.80, 48.70], [16.80, 48.75], [16.80, 48.80]]);
  });
});

describe('trimToStops', () => {
  it('cuts the corridor down to the span between first and last stop', () => {
    const trimmed = trimToStops(corridor, [[16.80, 48.70], [16.80, 48.80]], 250)!;
    expect(trimmed[0]![1]).toBeCloseTo(48.70, 4);
    expect(trimmed[trimmed.length - 1]![1]).toBeCloseTo(48.80, 4);
  });

  it('reverses the line when the stops run against its direction', () => {
    const reversed = [...corridor].reverse();
    const trimmed = trimToStops(reversed, [[16.80, 48.70], [16.80, 48.80]], 250)!;
    expect(trimmed[0]![1]).toBeCloseTo(48.70, 4);
    expect(trimmed[trimmed.length - 1]![1]).toBeCloseTo(48.80, 4);
  });

  it('rejects a line the stops do not lie near', () => {
    const elsewhere: [number, number][] = [[17.50, 48.60], [17.50, 48.90]];
    expect(trimToStops(elsewhere, [[16.80, 48.70], [16.80, 48.80]], 250)).toBeNull();
  });

  it('rejects a line the stops do not traverse monotonically', () => {
    // Stops in an order the corridor cannot produce: middle, start, end.
    const shuffled: [number, number][] = [[16.80, 48.75], [16.80, 48.70], [16.80, 48.80]];
    expect(trimToStops(corridor, shuffled, 250)).toBeNull();
  });
});

describe('matchPatternGeometry', () => {
  it('prefers an explicit override', () => {
    const override: [number, number][] = [[1, 1], [2, 2]];
    const result = matchPatternGeometry({ pattern, stops: stopById, relations: [], override });
    expect(result).toEqual({ coordinates: override, source: 'override' });
  });

  it('uses a matching OSM relation', () => {
    const result = matchPatternGeometry({
      pattern, stops: stopById, relations: [{ ref: '563', coordinates: corridor }],
    });
    expect(result.source).toBe('osm');
    expect(result.coordinates[0]![1]).toBeCloseTo(48.70, 4);
  });

  it('falls back to straight lines when no relation matches the line ref', () => {
    const result = matchPatternGeometry({
      pattern, stops: stopById, relations: [{ ref: '999', coordinates: corridor }],
    });
    expect(result).toEqual({
      coordinates: [[16.80, 48.70], [16.80, 48.75], [16.80, 48.80]],
      source: 'straight',
    });
  });

  it('falls back to straight lines when the matching relation is nowhere near the stops', () => {
    const result = matchPatternGeometry({
      pattern, stops: stopById,
      relations: [{ ref: '563', coordinates: [[17.50, 48.60], [17.50, 48.90]] }],
    });
    expect(result.source).toBe('straight');
  });

  it('picks the relation variant that fits best when several share a ref', () => {
    const short: [number, number][] = [[16.80, 48.70], [16.80, 48.75]];
    const result = matchPatternGeometry({
      pattern, stops: stopById,
      relations: [{ ref: '563', coordinates: short }, { ref: '563', coordinates: corridor }],
    });
    // The short variant does not reach stop 'c', so the corridor must win.
    expect(result.source).toBe('osm');
    expect(result.coordinates[result.coordinates.length - 1]![1]).toBeCloseTo(48.80, 4);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/match.test.ts`
Expected: FAIL — cannot resolve `../scripts/osm/match`.

- [ ] **Step 4: Write the implementation**

```ts
// scripts/osm/match.ts
import distance from '@turf/distance';
import { lineString, point } from '@turf/helpers';
import lineSlice from '@turf/line-slice';
import nearestPointOnLine from '@turf/nearest-point-on-line';
import type { Pattern, Stop } from '../../src/types/network';

export type GeometrySource = 'override' | 'osm' | 'straight';
export type Position = [number, number];

export interface RelationLine {
  ref: string;
  coordinates: Position[];
}

export function straightLine(pattern: Pattern, stops: Map<string, Stop>): Position[] {
  return pattern.stops
    .map((id) => stops.get(id))
    .filter((s): s is Stop => s !== undefined)
    .map((s) => [s.lon, s.lat] as Position);
}

/**
 * Cuts `line` down to the span the stops actually traverse.
 *
 * Returns null when the stops are too far from the line to be on it, or when
 * their positions along it are not increasing — which means this relation runs
 * the other way, or is the wrong variant entirely. The line is retried reversed
 * before giving up, since OSM relations are commonly drawn in one direction only.
 */
export function trimToStops(line: Position[], stopCoords: Position[], maxSnapMetres: number): Position[] | null {
  if (line.length < 2 || stopCoords.length < 2) {
    return null;
  }

  const attempt = (coords: Position[]): Position[] | null => {
    const feature = lineString(coords);
    const measured = stopCoords.map((c) => {
      const snapped = nearestPointOnLine(feature, point(c), { units: 'meters' });
      return {
        along: snapped.properties.location as number,
        offMetres: distance(point(c), snapped, { units: 'meters' }),
      };
    });

    if (measured.some((m) => m.offMetres > maxSnapMetres)) {
      return null;
    }
    for (let i = 1; i < measured.length; i += 1) {
      if (measured[i]!.along < measured[i - 1]!.along) {
        return null;
      }
    }

    const sliced = lineSlice(point(stopCoords[0]!), point(stopCoords[stopCoords.length - 1]!), feature);
    return sliced.geometry.coordinates as Position[];
  };

  return attempt(line) ?? attempt([...line].reverse());
}

export function matchPatternGeometry(args: {
  pattern: Pattern;
  stops: Map<string, Stop>;
  relations: RelationLine[];
  override?: Position[];
  maxSnapMetres?: number;
}): { coordinates: Position[]; source: GeometrySource } {
  const { pattern, stops, relations, override, maxSnapMetres = 250 } = args;

  if (override && override.length >= 2) {
    return { coordinates: override, source: 'override' };
  }

  const stopCoords = straightLine(pattern, stops);
  const candidates = relations
    .filter((r) => r.ref === pattern.line)
    .map((r) => trimToStops(r.coordinates, stopCoords, maxSnapMetres))
    .filter((c): c is Position[] => c !== null);

  if (candidates.length > 0) {
    // Several relation variants can fit. The longest surviving trim is the one
    // that actually reaches every stop rather than stopping short.
    const best = candidates.sort((a, b) => b.length - a.length)[0]!;
    return { coordinates: best, source: 'osm' };
  }

  return { coordinates: stopCoords, source: 'straight' };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/match.test.ts`
Expected: 10 passing.

- [ ] **Step 6: Commit**

```bash
git add scripts/osm/match.ts tests/match.test.ts
git commit -m "feat: match patterns to OSM geometry with straight-line fallback"
```

---

### Task 12: Converter orchestration and baking the real data

**Files:**
- Create: `scripts/build-network.ts`, `public/data/scenarios.json`
- Modify: `package.json` (add the `build:network` script)
- Test: `tests/sanity.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 6–11.
- Produces: `public/data/current/network.json`, `public/data/current/geometry.geojson`, `public/data/current/meta.json`, and `assertSane(net: Network, scope: ScopeConfig): void`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/sanity.test.ts
import { describe, expect, it } from 'vitest';
import { assertSane } from '../scripts/build-network';
import { loadScope } from '../scripts/gtfs/read';
import { tinyNetwork } from './fixtures/tinyNetwork';
import type { Network } from '../src/types/network';

const scope = { ...loadScope(), expectedRoutes: { min: 1, max: 5 } };

describe('assertSane', () => {
  it('accepts a plausible network', () => {
    expect(() => assertSane(tinyNetwork, scope)).not.toThrow();
  });

  it('rejects a route count outside the expected band', () => {
    expect(() => assertSane(tinyNetwork, { ...scope, expectedRoutes: { min: 10, max: 20 } }))
      .toThrow(/lines/i);
  });

  it('rejects a network with no trips', () => {
    const empty: Network = { ...structuredClone(tinyNetwork), trips: [] };
    expect(() => assertSane(empty, scope)).toThrow(/trips/i);
  });

  it('rejects a stop that no pattern serves', () => {
    const orphan: Network = structuredClone(tinyNetwork);
    orphan.stops.push({ id: 'z', name: 'Nikde', lat: 48, lon: 16 });
    expect(() => assertSane(orphan, scope)).toThrow(/z/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sanity.test.ts`
Expected: FAIL — cannot resolve `../scripts/build-network`.

- [ ] **Step 3: Write the orchestrator**

```ts
// scripts/build-network.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Meta, Network, Stop } from '../src/types/network';
import { validateNetwork } from '../src/data/validate';
import {
  assignLineIds, buildLines, buildPatternsAndTrips, buildServices, parseGtfsTime,
} from './gtfs/convert';
import type { TripShape } from './gtfs/convert';
import { downloadFeed, extractEntries, loadScope, streamCsv } from './gtfs/read';
import type { ScopeConfig } from './gtfs/read';
import {
  assignStopIds, buildParentMap, municipalityOf,
} from './gtfs/scope';
import type {
  GtfsCalendarDateRow, GtfsCalendarRow, GtfsRouteRow, GtfsStopRow, GtfsStopTimeRow, GtfsTripRow,
} from './gtfs/scope';
import { matchPatternGeometry } from './osm/match';
import type { Position, RelationLine } from './osm/match';
import { fetchRoutes } from './osm/overpass';
import { relationToLine } from './osm/stitch';
import type { OsmNode, OsmRelation, OsmWay } from './osm/overpass';

export const CONVERTER_VERSION = '1.0.0';

export function assertSane(net: Network, scope: ScopeConfig): void {
  const problems: string[] = [];

  if (net.lines.length < scope.expectedRoutes.min || net.lines.length > scope.expectedRoutes.max) {
    problems.push(`lines: ${net.lines.length} outside expected ${scope.expectedRoutes.min}..${scope.expectedRoutes.max}`);
  }
  if (net.trips.length === 0) {
    problems.push('trips: none produced');
  }
  if (net.patterns.some((p) => p.stops.length < 2)) {
    problems.push('patterns: at least one has fewer than 2 stops');
  }

  const served = new Set(net.patterns.flatMap((p) => p.stops));
  for (const stop of net.stops) {
    if (!served.has(stop.id)) {
      problems.push(`stop ${stop.id} is served by no pattern`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Sanity check failed:\n${problems.join('\n')}`);
  }
}

function sortNetwork(net: Network): Network {
  return {
    stops: [...net.stops].sort((a, b) => a.id.localeCompare(b.id)),
    lines: [...net.lines].sort((a, b) => a.id.localeCompare(b.id, 'cs', { numeric: true })),
    patterns: [...net.patterns].sort((a, b) => a.id.localeCompare(b.id, 'cs', { numeric: true })),
    services: [...net.services].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })),
    trips: [...net.trips].sort(
      (a, b) => a.pattern.localeCompare(b.pattern, 'cs', { numeric: true }) || a.start - b.start || a.service.localeCompare(b.service),
    ),
  };
}

async function main(): Promise<void> {
  const refreshOsm = process.argv.includes('--refresh-osm');
  const scope = loadScope();
  const cacheDir = 'data/cache/gtfs';
  const outDir = 'public/data/current';

  console.log('Downloading feed…');
  const { zipPath, feedDate } = await downloadFeed(scope.feedUrl, cacheDir);
  await extractEntries(zipPath, cacheDir, [
    'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'calendar.txt', 'calendar_dates.txt',
  ]);

  const stopRows: GtfsStopRow[] = [];
  await streamCsv<GtfsStopRow>(join(cacheDir, 'stops.txt'), (r) => stopRows.push(r));
  const parents = buildParentMap(stopRows);
  const stationRows = stopRows.filter((r) => (r.parent_station || r.stop_id) === r.stop_id);

  const routeRows: GtfsRouteRow[] = [];
  await streamCsv<GtfsRouteRow>(join(cacheDir, 'routes.txt'), (r) => routeRows.push(r));

  const tripRows = new Map<string, GtfsTripRow>();
  await streamCsv<GtfsTripRow>(join(cacheDir, 'trips.txt'), (r) => tripRows.set(r.trip_id, r));

  // Pass 1: collect each trip's stop sequence, in parent-station ids.
  console.log('Reading stop_times…');
  const sequences = new Map<string, Array<{ seq: number; station: string; minutes: number }>>();
  await streamCsv<GtfsStopTimeRow>(join(cacheDir, 'stop_times.txt'), (r) => {
    const station = parents.get(r.stop_id) ?? r.stop_id;
    const list = sequences.get(r.trip_id);
    const entry = { seq: Number(r.stop_sequence), station, minutes: parseGtfsTime(r.departure_time) };
    if (list) {
      list.push(entry);
    } else {
      sequences.set(r.trip_id, [entry]);
    }
  });
  for (const list of sequences.values()) {
    list.sort((a, b) => a.seq - b.seq);
  }

  // Pass 2: routes touching Břeclav, then every trip of those routes.
  const breclavStations = new Set(
    stationRows.filter((r) => municipalityOf(r.stop_name) === scope.municipality).map((r) => r.stop_id),
  );
  const routeIds = new Set<string>();
  for (const [tripId, list] of sequences) {
    if (!list.some((e) => breclavStations.has(e.station))) {
      continue;
    }
    const trip = tripRows.get(tripId);
    if (trip) {
      routeIds.add(trip.route_id);
    }
  }

  const selectedRoutes = routeRows.filter((r) => routeIds.has(r.route_id));
  const lineIds = assignLineIds(selectedRoutes);

  const shapes: TripShape[] = [];
  const usedStations = new Set<string>();
  for (const [tripId, list] of sequences) {
    const trip = tripRows.get(tripId);
    if (!trip || !routeIds.has(trip.route_id)) {
      continue;
    }
    for (const e of list) {
      usedStations.add(e.station);
    }
    shapes.push({
      tripId,
      routeId: trip.route_id,
      directionId: trip.direction_id === '1' ? 1 : 0,
      headsign: trip.trip_headsign,
      serviceId: trip.service_id,
      stops: list.map((e) => e.station),
      times: list.map((e) => e.minutes),
    });
  }

  const stationById = new Map(stationRows.map((r) => [r.stop_id, r]));
  const childOf = new Map<string, GtfsStopRow>();
  for (const r of stopRows) {
    const parent = r.parent_station || r.stop_id;
    if (!childOf.has(parent)) {
      childOf.set(parent, r);
    }
  }

  const stopIds = assignStopIds([...usedStations].map((id) => stationById.get(id)).filter((r): r is GtfsStopRow => !!r));
  const stops: Stop[] = [...usedStations]
    .map((id) => {
      const station = stationById.get(id);
      if (!station) {
        return null;
      }
      const child = childOf.get(id) ?? station;
      return {
        id: stopIds.get(id)!,
        name: station.stop_name,
        lat: Number(station.stop_lat),
        lon: Number(station.stop_lon),
        zone: child.zone_id || undefined,
        wheelchair: child.wheelchair_boarding === '1' ? true : undefined,
        sourceId: id,
      } satisfies Stop;
    })
    .filter((s): s is Stop => s !== null);

  // Re-key trip shapes from GTFS station ids to the readable slugs.
  for (const shape of shapes) {
    shape.stops = shape.stops.map((id) => stopIds.get(id) ?? id);
  }

  const calendarRows: GtfsCalendarRow[] = [];
  await streamCsv<GtfsCalendarRow>(join(cacheDir, 'calendar.txt'), (r) => calendarRows.push(r));
  const calendarDateRows: GtfsCalendarDateRow[] = [];
  await streamCsv<GtfsCalendarDateRow>(join(cacheDir, 'calendar_dates.txt'), (r) => calendarDateRows.push(r));

  const usedServices = new Set(shapes.map((s) => s.serviceId));
  const services = buildServices(
    calendarRows.filter((r) => usedServices.has(r.service_id)),
    calendarDateRows.filter((r) => usedServices.has(r.service_id)),
  );

  const { patterns, trips } = buildPatternsAndTrips(shapes, lineIds);
  const network = sortNetwork({ stops, lines: buildLines(selectedRoutes, lineIds), patterns, services, trips });

  validateNetwork(network);
  assertSane(network, scope);

  console.log('Fetching OSM geometry…');
  const osm = await fetchRoutes(scope, { refresh: refreshOsm });
  const relations = osm.elements.filter((e): e is OsmRelation => e.type === 'relation');
  const ways = osm.elements.filter((e): e is OsmWay => e.type === 'way');
  const nodes = osm.elements.filter((e): e is OsmNode => e.type === 'node');
  const relationLines: RelationLine[] = relations
    .map((r) => ({ ref: r.tags.ref ?? '', coordinates: relationToLine(r, ways, nodes) }))
    .filter((r) => r.ref !== '' && r.coordinates.length >= 2);

  const stopById = new Map(network.stops.map((s) => [s.id, s]));
  const counts = { osm: 0, straight: 0, override: 0 };
  const features = network.patterns.map((pattern) => {
    const overridePath = join('data/geometry-overrides', `${pattern.id}.geojson`);
    let override: Position[] | undefined;
    if (existsSync(overridePath)) {
      const parsed = JSON.parse(readFileSync(overridePath, 'utf8')) as { geometry?: { coordinates?: Position[] }; coordinates?: Position[] };
      override = parsed.geometry?.coordinates ?? parsed.coordinates;
    }

    const line = network.lines.find((l) => l.id === pattern.line)!;
    const { coordinates, source } = matchPatternGeometry({ pattern, stops: stopById, relations: relationLines, override });
    counts[source] += 1;

    return {
      type: 'Feature' as const,
      properties: {
        patternId: pattern.id,
        lineId: line.id,
        lineName: line.name,
        mode: line.mode,
        color: line.color,
        source,
      },
      geometry: { type: 'LineString' as const, coordinates },
    };
  });

  const meta: Meta = {
    feedDate,
    generatedAt: new Date().toISOString(),
    converterVersion: CONVERTER_VERSION,
    geometrySources: counts,
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'network.json'), `${JSON.stringify(network, null, 1)}\n`, 'utf8');
  writeFileSync(
    join(outDir, 'geometry.geojson'),
    `${JSON.stringify({ type: 'FeatureCollection', features }, null, 1)}\n`,
    'utf8',
  );
  writeFileSync(join(outDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  console.log(`Feed ${feedDate}: ${network.lines.length} lines, ${network.stops.length} stops, ${network.patterns.length} patterns, ${network.trips.length} trips`);
  console.log(`Geometry: ${counts.osm} from OSM, ${counts.override} overridden, ${counts.straight} straight-line fallbacks`);
  if (counts.straight > 0) {
    const fallbacks = features.filter((f) => f.properties.source === 'straight').map((f) => f.properties.patternId);
    console.log(`Fallback patterns (override worklist): ${fallbacks.join(', ')}`);
  }
}

if (process.argv[1]?.endsWith('build-network.ts')) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Add the npm script and the scenario list**

```bash
npm pkg set scripts."build:network"="tsx scripts/build-network.ts"
```

```json
// public/data/scenarios.json
[{ "id": "current", "label": "Současný stav" }]
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/sanity.test.ts`
Expected: 4 passing.

- [ ] **Step 6: Bake the real data**

Run: `npm run build:network`

Expected output: roughly 20 lines, 164 stops, 252 patterns, 1844 trips. Do not proceed if the counts are far from these — the spec's measurements are the reference.

Note the reported straight-line fallback count. Fallbacks are acceptable at this stage; they are the worklist for manual overrides, not a failure.

- [ ] **Step 7: Commit the generated data**

```bash
git add public/data data/cache/osm scripts/build-network.ts tests/sanity.test.ts package.json
git commit -m "feat: add network converter and bake the current scenario"
```

---

### Task 13: Scenario loading and the map shell

**Files:**
- Create: `src/data/loadScenario.ts`, `src/state/store.ts`, `src/map/style.ts`, `src/map/MapView.tsx`, `src/ui/App.css`
- Modify: `src/ui/App.tsx`
- Test: `tests/loadScenario.test.ts`

**Interfaces:**
- Consumes: `Network`, `Meta`, `ScenarioRef`, `buildIndex`.
- Produces:
  - `Scenario` interface `{ id, label, index, meta, geometry }`
  - `loadScenario(id: string, fetchImpl?: typeof fetch): Promise<Scenario>`
  - `listScenarios(fetchImpl?: typeof fetch): Promise<ScenarioRef[]>`
  - `useStore` Zustand store with `{ scenario, error, selectedLine, selectedStop, date, minutes }` and setters.
  - `<MapView />` rendering the basemap plus route and stop layers.

- [ ] **Step 1: Write the failing test**

```ts
// tests/loadScenario.test.ts
import { describe, expect, it, vi } from 'vitest';
import { loadScenario } from '../src/data/loadScenario';
import { tinyNetwork } from './fixtures/tinyNetwork';

const meta = { feedDate: '2026-08-28', generatedAt: '2026-09-02T00:00:00Z', converterVersion: '1.0.0', geometrySources: { osm: 1, straight: 0, override: 0 } };
const geometry = { type: 'FeatureCollection', features: [] };

function fakeFetch(bodies: Record<string, unknown>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(bodies).find((k) => url.endsWith(k));
    if (!key) {
      return new Response('not found', { status: 404 });
    }
    return new Response(JSON.stringify(bodies[key]), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('loadScenario', () => {
  it('loads, validates, and indexes a scenario', async () => {
    const scenario = await loadScenario('current', fakeFetch({
      'network.json': tinyNetwork,
      'meta.json': meta,
      'geometry.geojson': geometry,
    }));

    expect(scenario.id).toBe('current');
    expect(scenario.meta.feedDate).toBe('2026-08-28');
    expect(scenario.index.lines.get('563')?.name).toBe('563');
  });

  it('throws a readable error when a file is missing', async () => {
    await expect(loadScenario('current', fakeFetch({ 'meta.json': meta })))
      .rejects.toThrow(/network\.json/);
  });

  it('throws when the network fails validation', async () => {
    const broken = structuredClone(tinyNetwork);
    broken.patterns[0]!.stops[0] = 'ghost';
    await expect(loadScenario('current', fakeFetch({
      'network.json': broken, 'meta.json': meta, 'geometry.geojson': geometry,
    }))).rejects.toThrow(/ghost/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/loadScenario.test.ts`
Expected: FAIL — cannot resolve `../src/data/loadScenario`.

- [ ] **Step 3: Write the loader and store**

```ts
// src/data/loadScenario.ts
import type { FeatureCollection, LineString } from 'geojson';
import type { Meta, Network, ScenarioRef } from '../types/network';
import { buildIndex } from './buildIndex';
import type { NetworkIndex } from './buildIndex';
import { validateNetwork } from './validate';

export interface PatternProperties {
  patternId: string;
  lineId: string;
  lineName: string;
  mode: string;
  color: string;
  source: string;
}

export interface Scenario {
  id: string;
  index: NetworkIndex;
  meta: Meta;
  geometry: FeatureCollection<LineString, PatternProperties>;
}

function dataUrl(path: string): string {
  return `${import.meta.env.BASE_URL}data/${path}`;
}

async function getJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`Nepodařilo se načíst ${url} (HTTP ${res.status})`);
  }
  return (await res.json()) as T;
}

export async function listScenarios(fetchImpl: typeof fetch = fetch): Promise<ScenarioRef[]> {
  return getJson<ScenarioRef[]>(dataUrl('scenarios.json'), fetchImpl);
}

export async function loadScenario(id: string, fetchImpl: typeof fetch = fetch): Promise<Scenario> {
  const [network, meta, geometry] = await Promise.all([
    getJson<Network>(dataUrl(`${id}/network.json`), fetchImpl),
    getJson<Meta>(dataUrl(`${id}/meta.json`), fetchImpl),
    getJson<FeatureCollection<LineString, PatternProperties>>(dataUrl(`${id}/geometry.geojson`), fetchImpl),
  ]);

  validateNetwork(network);
  return { id, index: buildIndex(network), meta, geometry };
}
```

Install the GeoJSON types: `npm install -D @types/geojson`.

```ts
// src/state/store.ts
import { create } from 'zustand';
import type { Scenario } from '../data/loadScenario';

function nowInPrague(): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Prague',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

interface State {
  scenarioId: string;
  scenario: Scenario | null;
  error: string | null;
  selectedLine: string | null;
  selectedStop: string | null;
  date: string;
  minutes: number;
  setScenario: (scenario: Scenario) => void;
  setScenarioId: (id: string) => void;
  setError: (message: string | null) => void;
  selectLine: (lineId: string | null) => void;
  selectStop: (stopId: string | null) => void;
  setMoment: (date: string, minutes: number) => void;
}

export const useStore = create<State>((set) => ({
  scenarioId: 'current',
  scenario: null,
  error: null,
  selectedLine: null,
  selectedStop: null,
  ...nowInPrague(),
  setScenario: (scenario) => set({ scenario, error: null }),
  setScenarioId: (scenarioId) => set({ scenarioId, selectedLine: null, selectedStop: null }),
  setError: (error) => set({ error }),
  selectLine: (selectedLine) => set({ selectedLine }),
  selectStop: (selectedStop) => set({ selectedStop }),
  setMoment: (date, minutes) => set({ date, minutes }),
}));

export { nowInPrague };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/loadScenario.test.ts`
Expected: 3 passing.

- [ ] **Step 5: Write the map view**

```ts
// src/map/style.ts
export const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

export const BRECLAV_CENTER: [number, number] = [16.882, 48.759];
export const INITIAL_ZOOM = 12;

export const DIM_COLOR = '#b6bcc4';
```

```tsx
// src/map/MapView.tsx
import maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useStore } from '../state/store';
import { BASEMAP_STYLE, BRECLAV_CENTER, DIM_COLOR, INITIAL_ZOOM } from './style';
import type { Scenario } from '../data/loadScenario';
import type { FeatureCollection, Point } from 'geojson';

function stopsGeoJson(scenario: Scenario): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: scenario.index.network.stops.map((stop) => ({
      type: 'Feature',
      properties: { id: stop.id, name: stop.name },
      geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] },
    })),
  };
}

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const scenario = useStore((s) => s.scenario);
  const selectedLine = useStore((s) => s.selectedLine);
  const selectStop = useStore((s) => s.selectStop);

  // The map instance is created once and never re-created; state is pushed
  // into it imperatively below.
  useEffect(() => {
    if (map.current || !container.current) {
      return;
    }
    map.current = new maplibregl.Map({
      container: container.current,
      style: BASEMAP_STYLE,
      center: BRECLAV_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: { compact: false },
    });
    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !scenario) {
      return;
    }

    const install = () => {
      if (m.getSource('routes')) {
        return;
      }

      m.addSource('routes', { type: 'geojson', data: scenario.geometry });
      m.addSource('stops', { type: 'geojson', data: stopsGeoJson(scenario) });
      m.addSource('stops-selected', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

      m.addLayer({
        id: 'routes-dim',
        type: 'line',
        source: 'routes',
        filter: ['==', ['get', 'lineId'], ' '],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': DIM_COLOR, 'line-width': 2 },
      });
      m.addLayer({
        id: 'routes-active',
        type: 'line',
        source: 'routes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 4, 17, 7],
          'line-opacity': 0.85,
        },
      });
      m.addLayer({
        id: 'stops-circle',
        type: 'circle',
        source: 'stops',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 15, 5],
          'circle-color': '#ffffff',
          'circle-stroke-color': '#37404a',
          'circle-stroke-width': 1.5,
        },
      });
      m.addLayer({
        id: 'stops-selected-circle',
        type: 'circle',
        source: 'stops-selected',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 15, 7],
          'circle-color': '#ffffff',
          'circle-stroke-color': '#111820',
          'circle-stroke-width': 2.5,
        },
      });
      m.addLayer({
        id: 'stops-label',
        type: 'symbol',
        source: 'stops',
        minzoom: 13,
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 11,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
        },
        paint: { 'text-color': '#26303a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
      });

      m.on('click', 'stops-circle', (event) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === 'string') {
          selectStop(id);
        }
      });
      for (const layer of ['stops-circle', 'stops-selected-circle']) {
        m.on('mouseenter', layer, () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', layer, () => { m.getCanvas().style.cursor = ''; });
      }
    };

    if (m.isStyleLoaded()) {
      install();
    } else {
      m.once('load', install);
    }
  }, [scenario, selectStop]);

  // Highlight by filter — the sources are never rebuilt.
  useEffect(() => {
    const m = map.current;
    if (!m || !m.getLayer('routes-active')) {
      return;
    }

    if (selectedLine === null) {
      m.setFilter('routes-active', null);
      m.setFilter('routes-dim', ['==', ['get', 'lineId'], ' ']);
    } else {
      m.setFilter('routes-active', ['==', ['get', 'lineId'], selectedLine]);
      m.setFilter('routes-dim', ['!=', ['get', 'lineId'], selectedLine]);
    }
  }, [selectedLine]);

  return <div ref={container} className="map" />;
}
```

```css
/* src/ui/App.css */
:root { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1b2229; }
* { box-sizing: border-box; }
body { margin: 0; }

.layout { display: grid; grid-template-columns: 280px 1fr; grid-template-rows: 1fr auto; height: 100vh; }
.sidebar { overflow-y: auto; border-right: 1px solid #dfe3e8; padding: 12px; }
.map { width: 100%; height: 100%; }
.footer { grid-column: 1 / -1; border-top: 1px solid #dfe3e8; padding: 6px 12px; font-size: 12px; color: #5b6672; }
.panel { position: absolute; right: 12px; top: 12px; width: 320px; max-height: 70vh; overflow-y: auto;
  background: #fff; border: 1px solid #dfe3e8; border-radius: 6px; padding: 12px; }
.banner { background: #fdecea; border: 1px solid #f5c2c0; color: #8b1f18; padding: 12px; margin: 12px; border-radius: 6px; }

@media (max-width: 720px) {
  .layout { grid-template-columns: 1fr; grid-template-rows: 180px 1fr auto; }
  .panel { position: static; width: auto; margin: 12px; }
}
```

```tsx
// src/ui/App.tsx
import { useEffect } from 'react';
import { MapView } from '../map/MapView';
import { loadScenario } from '../data/loadScenario';
import { useStore } from '../state/store';
import './App.css';

export function App() {
  const scenarioId = useStore((s) => s.scenarioId);
  const scenario = useStore((s) => s.scenario);
  const error = useStore((s) => s.error);
  const setScenario = useStore((s) => s.setScenario);
  const setError = useStore((s) => s.setError);

  useEffect(() => {
    let cancelled = false;
    loadScenario(scenarioId)
      .then((loaded) => {
        if (!cancelled) {
          setScenario(loaded);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => { cancelled = true; };
  }, [scenarioId, setScenario, setError]);

  if (error !== null) {
    return <div className="banner">Data se nepodařilo načíst: {error}</div>;
  }
  if (scenario === null) {
    return <div className="banner">Načítám síť…</div>;
  }

  return (
    <div className="layout">
      <aside className="sidebar">Linky</aside>
      <div style={{ position: 'relative' }}><MapView /></div>
    </div>
  );
}
```

- [ ] **Step 6: Verify in the browser**

Run: `npm run dev`
Open the printed URL. Expected: the basemap renders, coloured route lines appear across the Břeclav area, and stop circles are clickable.

- [ ] **Step 7: Commit**

```bash
git add src package.json package-lock.json tests/loadScenario.test.ts
git commit -m "feat: load scenarios and render the network on a MapLibre basemap"
```

---

### Task 14: Line browser

**Files:**
- Create: `src/ui/LineBrowser.tsx`
- Modify: `src/ui/App.tsx`

**Interfaces:**
- Consumes: `useStore`, `NetworkIndex`.
- Produces: `<LineBrowser />`.

- [ ] **Step 1: Write the component**

No unit test here — this is presentational, and Task 17's smoke test covers it end to end.

```tsx
// src/ui/LineBrowser.tsx
import { useStore } from '../state/store';

export function LineBrowser() {
  const scenario = useStore((s) => s.scenario);
  const selectedLine = useStore((s) => s.selectedLine);
  const selectLine = useStore((s) => s.selectLine);
  if (!scenario) {
    return null;
  }

  const lines = scenario.index.network.lines;
  const buses = lines.filter((l) => l.mode === 'bus');
  const trains = lines.filter((l) => l.mode === 'rail');

  const group = (title: string, items: typeof lines) =>
    items.length === 0 ? null : (
      <section key={title}>
        <h2 className="group-title">{title}</h2>
        <ul className="line-list">
          {items.map((line) => (
            <li key={line.id}>
              <button
                type="button"
                className={line.id === selectedLine ? 'line line-active' : 'line'}
                onClick={() => selectLine(line.id === selectedLine ? null : line.id)}
                aria-pressed={line.id === selectedLine}
              >
                <span className="badge" style={{ background: line.color, color: line.textColor }}>{line.name}</span>
                <span className="line-name">{line.longName}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <nav>
      <h1 className="title">MHD Břeclav</h1>
      {selectedLine !== null && (
        <button type="button" className="clear" onClick={() => selectLine(null)}>
          Zobrazit všechny linky
        </button>
      )}
      {group('Autobusy', buses)}
      {group('Vlaky', trains)}
    </nav>
  );
}
```

- [ ] **Step 2: Add the styles**

Append to `src/ui/App.css`:

```css
.title { font-size: 16px; margin: 0 0 12px; }
.group-title { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #6b7580; margin: 16px 0 6px; }
.line-list { list-style: none; margin: 0; padding: 0; }
.line { display: flex; gap: 8px; align-items: center; width: 100%; text-align: left; padding: 6px;
  background: none; border: 0; border-radius: 4px; cursor: pointer; font: inherit; }
.line:hover { background: #f1f4f7; }
.line-active { background: #e4ecf5; }
.badge { flex: none; min-width: 40px; text-align: center; padding: 2px 6px; border-radius: 4px;
  font-size: 12px; font-weight: 600; }
.line-name { font-size: 12px; color: #4a545f; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.clear { width: 100%; margin-bottom: 8px; padding: 6px; font: inherit; font-size: 12px; cursor: pointer;
  background: #f1f4f7; border: 1px solid #dfe3e8; border-radius: 4px; }
```

- [ ] **Step 3: Mount it**

In `src/ui/App.tsx`, replace `<aside className="sidebar">Linky</aside>` with:

```tsx
<aside className="sidebar"><LineBrowser /></aside>
```

and add `import { LineBrowser } from './LineBrowser';`.

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`
Expected: the sidebar lists buses and trains. Clicking line 563 greys every other route and draws 563 in its own colour. Clicking it again restores all lines.

- [ ] **Step 5: Commit**

```bash
git add src/ui
git commit -m "feat: add line browser with map highlight"
```

---

### Task 15: Stop panel, time control, and departure board

**Files:**
- Create: `src/ui/TimeControl.tsx`, `src/ui/StopPanel.tsx`
- Modify: `src/ui/App.tsx`, `src/ui/App.css`, `src/map/MapView.tsx`

**Interfaces:**
- Consumes: `departuresAt`, `formatMinutes` (Task 5); `useStore`.
- Produces: `<TimeControl />`, `<StopPanel />`, and a `stops-selected` source kept in sync with the selected line.

- [ ] **Step 1: Write the time control**

```tsx
// src/ui/TimeControl.tsx
import { formatMinutes } from '../domain/formatMinutes';
import { nowInPrague, useStore } from '../state/store';

export function TimeControl() {
  const date = useStore((s) => s.date);
  const minutes = useStore((s) => s.minutes);
  const setMoment = useStore((s) => s.setMoment);

  return (
    <div className="time-control">
      <label>
        Datum
        <input type="date" value={date} onChange={(e) => setMoment(e.target.value, minutes)} />
      </label>
      <label>
        Čas
        <input
          type="time"
          value={formatMinutes(minutes)}
          onChange={(e) => {
            const [h, m] = e.target.value.split(':');
            if (h !== undefined && m !== undefined) {
              setMoment(date, Number(h) * 60 + Number(m));
            }
          }}
        />
      </label>
      <button type="button" onClick={() => { const now = nowInPrague(); setMoment(now.date, now.minutes); }}>
        Teď
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Write the stop panel**

```tsx
// src/ui/StopPanel.tsx
import { departuresAt } from '../domain/departures';
import { formatMinutes } from '../domain/formatMinutes';
import { useStore } from '../state/store';
import { TimeControl } from './TimeControl';

export function StopPanel() {
  const scenario = useStore((s) => s.scenario);
  const selectedStop = useStore((s) => s.selectedStop);
  const selectStop = useStore((s) => s.selectStop);
  const selectLine = useStore((s) => s.selectLine);
  const date = useStore((s) => s.date);
  const minutes = useStore((s) => s.minutes);

  if (!scenario || selectedStop === null) {
    return null;
  }

  const stop = scenario.index.stops.get(selectedStop);
  if (!stop) {
    return null;
  }

  const lines = scenario.index.linesByStop.get(stop.id) ?? [];
  const departures = departuresAt(scenario.index, stop.id, date, minutes);

  return (
    <aside className="panel" data-testid="stop-panel">
      <button type="button" className="close" onClick={() => selectStop(null)} aria-label="Zavřít">×</button>
      <h2 className="panel-title">{stop.name}</h2>
      <p className="panel-meta">
        {stop.zone ? `Zóna ${stop.zone}` : 'Zóna neuvedena'}
        {stop.wheelchair ? ' · bezbariérová' : ''}
      </p>

      <h3 className="group-title">Linky</h3>
      <ul className="badge-row">
        {lines.map((line) => (
          <li key={line.id}>
            <button
              type="button"
              className="badge"
              style={{ background: line.color, color: line.textColor }}
              onClick={() => selectLine(line.id)}
            >
              {line.name}
            </button>
          </li>
        ))}
      </ul>

      <h3 className="group-title">Odjezdy</h3>
      <TimeControl />
      {departures.length === 0 ? (
        <p className="empty">V tuto dobu odsud nic nejede.</p>
      ) : (
        <table className="departures">
          <tbody>
            {departures.map((d, i) => (
              <tr key={`${d.patternId}-${d.time}-${i}`}>
                <td className="dep-time">{formatMinutes(d.time)}</td>
                <td className="dep-line">{d.lineName}</td>
                <td className="dep-headsign">{d.headsign}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </aside>
  );
}
```

- [ ] **Step 3: Add the styles**

Append to `src/ui/App.css`:

```css
.panel-title { font-size: 15px; margin: 0 0 4px; padding-right: 20px; }
.panel-meta { font-size: 12px; color: #6b7580; margin: 0 0 8px; }
.close { position: absolute; right: 8px; top: 6px; border: 0; background: none; font-size: 18px; cursor: pointer; color: #6b7580; }
.badge-row { display: flex; flex-wrap: wrap; gap: 4px; list-style: none; margin: 0 0 8px; padding: 0; }
.badge-row .badge { border: 0; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600; }
.time-control { display: flex; gap: 8px; align-items: flex-end; margin-bottom: 8px; font-size: 12px; }
.time-control label { display: flex; flex-direction: column; gap: 2px; color: #6b7580; }
.time-control input { font: inherit; padding: 3px; border: 1px solid #dfe3e8; border-radius: 4px; }
.time-control button { font: inherit; padding: 4px 8px; border: 1px solid #dfe3e8; border-radius: 4px; background: #f1f4f7; cursor: pointer; }
.departures { width: 100%; border-collapse: collapse; font-size: 13px; }
.departures td { padding: 3px 0; border-bottom: 1px solid #eef1f4; }
.dep-time { font-variant-numeric: tabular-nums; font-weight: 600; width: 48px; }
.dep-line { width: 48px; color: #4a545f; }
.dep-headsign { color: #6b7580; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { font-size: 12px; color: #6b7580; }
```

- [ ] **Step 4: Highlight the selected line's stops on the map**

Add this effect to `src/map/MapView.tsx`, after the existing highlight effect. It updates only the small `stops-selected` source, leaving the main sources alone.

```tsx
  useEffect(() => {
    const m = map.current;
    if (!m || !scenario) {
      return;
    }
    const source = m.getSource('stops-selected') as maplibregl.GeoJSONSource | undefined;
    if (!source) {
      return;
    }

    if (selectedLine === null) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const ids = new Set(
      scenario.index.network.patterns
        .filter((p) => p.line === selectedLine)
        .flatMap((p) => p.stops),
    );
    source.setData({
      type: 'FeatureCollection',
      features: scenario.index.network.stops
        .filter((s) => ids.has(s.id))
        .map((s) => ({
          type: 'Feature',
          properties: { id: s.id, name: s.name },
          geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        })),
    });
  }, [scenario, selectedLine]);
```

- [ ] **Step 5: Mount the panel**

In `src/ui/App.tsx`, add `import { StopPanel } from './StopPanel';` and render it inside the relative-positioned map wrapper:

```tsx
<div style={{ position: 'relative' }}>
  <MapView />
  <StopPanel />
</div>
```

- [ ] **Step 6: Verify in the browser**

Run: `npm run dev`

Check all of:
1. Clicking a stop opens the panel with its name, zone, and serving lines.
2. Departures are listed in time order from the current Prague time.
3. Setting the time to 23:50 at a stop served late shows post-midnight departures with times like `00:10`.
4. Setting the date to a Sunday changes the departures.
5. A stop with no service shows "V tuto dobu odsud nic nejede." rather than an empty table.

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "feat: add stop panel with departure board and time control"
```

---

### Task 16: URL state and footer attribution

Attribution is a licence obligation, not decoration: the timetable data is CC-BY-4.0 and the geometry is ODbL.

**Files:**
- Create: `src/ui/Footer.tsx`, `src/state/urlState.ts`
- Modify: `src/ui/App.tsx`
- Test: `tests/urlState.test.ts`

**Interfaces:**
- Consumes: `useStore`.
- Produces:
  - `readUrlState(search: string): Partial<{ scenarioId: string; selectedLine: string; selectedStop: string; date: string; minutes: number }>`
  - `writeUrlState(state): string`
  - `<Footer />`

- [ ] **Step 1: Write the failing test**

```ts
// tests/urlState.test.ts
import { describe, expect, it } from 'vitest';
import { readUrlState, writeUrlState } from '../src/state/urlState';

describe('readUrlState', () => {
  it('reads every field', () => {
    expect(readUrlState('?s=proposed&line=563&stop=breclav-aut-nadr&d=2026-09-02&t=07:30')).toEqual({
      scenarioId: 'proposed',
      selectedLine: '563',
      selectedStop: 'breclav-aut-nadr',
      date: '2026-09-02',
      minutes: 450,
    });
  });

  it('returns an empty object for an empty query string', () => {
    expect(readUrlState('')).toEqual({});
  });

  it('ignores a malformed time', () => {
    expect(readUrlState('?t=nonsense')).toEqual({});
  });

  it('ignores a malformed date', () => {
    expect(readUrlState('?d=2026-9-2')).toEqual({});
  });
});

describe('writeUrlState', () => {
  it('omits null selections', () => {
    expect(writeUrlState({ scenarioId: 'current', selectedLine: null, selectedStop: null, date: '2026-09-02', minutes: 450 }))
      .toBe('?s=current&d=2026-09-02&t=07%3A30');
  });

  it('round-trips through readUrlState', () => {
    const state = { scenarioId: 'current', selectedLine: '563', selectedStop: 'a', date: '2026-09-02', minutes: 450 };
    expect(readUrlState(writeUrlState(state))).toEqual(state);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/urlState.test.ts`
Expected: FAIL — cannot resolve `../src/state/urlState`.

- [ ] **Step 3: Write the implementation**

```ts
// src/state/urlState.ts
import { formatMinutes } from '../domain/formatMinutes';

export interface UrlState {
  scenarioId: string;
  selectedLine: string | null;
  selectedStop: string | null;
  date: string;
  minutes: number;
}

export function readUrlState(search: string): Partial<UrlState> {
  const params = new URLSearchParams(search);
  const state: Partial<UrlState> = {};

  const scenarioId = params.get('s');
  if (scenarioId) {
    state.scenarioId = scenarioId;
  }

  const line = params.get('line');
  if (line) {
    state.selectedLine = line;
  }

  const stop = params.get('stop');
  if (stop) {
    state.selectedStop = stop;
  }

  const date = params.get('d');
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    state.date = date;
  }

  const time = params.get('t');
  if (time && /^\d{2}:\d{2}$/.test(time)) {
    const [h, m] = time.split(':');
    state.minutes = Number(h) * 60 + Number(m);
  }

  return state;
}

export function writeUrlState(state: UrlState): string {
  const params = new URLSearchParams();
  params.set('s', state.scenarioId);
  if (state.selectedLine !== null) {
    params.set('line', state.selectedLine);
  }
  if (state.selectedStop !== null) {
    params.set('stop', state.selectedStop);
  }
  params.set('d', state.date);
  params.set('t', formatMinutes(state.minutes));
  return `?${params.toString()}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/urlState.test.ts`
Expected: 6 passing.

- [ ] **Step 5: Write the footer**

```tsx
// src/ui/Footer.tsx
import { useStore } from '../state/store';

export function Footer() {
  const scenario = useStore((s) => s.scenario);

  const feedDate = scenario
    ? new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'long' }).format(new Date(`${scenario.meta.feedDate}T00:00:00Z`))
    : null;

  return (
    <footer className="footer">
      {feedDate && <>Jízdní řády k {feedDate}. </>}
      Data:{' '}
      <a href="https://data.brno.cz/datasets/379d2e9a7907460c8ca7fda1f3e84328/about">KORDIS JMK</a>
      {' '}(CC BY 4.0). Mapové podklady © přispěvatelé{' '}
      <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> (ODbL).
    </footer>
  );
}
```

- [ ] **Step 6: Wire URL state and the footer into the app**

Add to `src/ui/App.tsx`: import `Footer`, `readUrlState`, `writeUrlState`, and `useStore`. Add two effects.

```tsx
  // Restore state from the URL once, before the scenario loads.
  useEffect(() => {
    const initial = readUrlState(window.location.search);
    const store = useStore.getState();
    if (initial.scenarioId) {
      store.setScenarioId(initial.scenarioId);
    }
    if (initial.selectedLine) {
      store.selectLine(initial.selectedLine);
    }
    if (initial.selectedStop) {
      store.selectStop(initial.selectedStop);
    }
    if (initial.date && initial.minutes !== undefined) {
      store.setMoment(initial.date, initial.minutes);
    }
  }, []);

  // Mirror state back into the URL so any view is linkable.
  useEffect(() => {
    const unsubscribe = useStore.subscribe((s) => {
      const search = writeUrlState({
        scenarioId: s.scenarioId,
        selectedLine: s.selectedLine,
        selectedStop: s.selectedStop,
        date: s.date,
        minutes: s.minutes,
      });
      window.history.replaceState(null, '', `${window.location.pathname}${search}`);
    });
    return unsubscribe;
  }, []);
```

Render `<Footer />` as the last child of `.layout`.

- [ ] **Step 7: Verify in the browser**

Run: `npm run dev`
Select a line, click a stop, change the time. The address bar updates. Copy the URL into a new tab and confirm the same line, stop, and time come back. The footer shows the feed date and both attributions.

- [ ] **Step 8: Commit**

```bash
git add src tests/urlState.test.ts
git commit -m "feat: mirror selection state in the URL and add data attribution"
```

---

### Task 17: End-to-end smoke test

One test, covering the integration seam that unit tests structurally cannot reach: real data files, a real map, real clicks.

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`
- Modify: `package.json`, `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: the built site.
- Produces: `npm run test:e2e`.

- [ ] **Step 1: Install Playwright**

```bash
npm install -D @playwright/test
npx playwright install --with-deps chromium
npm pkg set scripts."test:e2e"="playwright test"
```

- [ ] **Step 2: Write the config**

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:4173/Breclav-MHD-Mapa/' },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173',
    url: 'http://localhost:4173/Breclav-MHD-Mapa/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
```

- [ ] **Step 3: Write the test**

```ts
// e2e/smoke.spec.ts
import { expect, test } from '@playwright/test';

test('browse a line and read departures at a stop', async ({ page }) => {
  await page.goto('/');

  // The sidebar renders once the scenario has loaded and validated.
  const line = page.getByRole('button', { name: /^563/ });
  await expect(line).toBeVisible({ timeout: 30_000 });

  await line.click();
  await expect(line).toHaveAttribute('aria-pressed', 'true');

  // Deep-link straight to a stop rather than clicking a canvas feature,
  // which is far less brittle than hunting for a rendered circle.
  await page.goto('/?s=current&stop=breclav-autobusove-nadrazi&d=2026-09-02&t=07%3A00');

  const panel = page.getByTestId('stop-panel');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByRole('heading', { level: 2 })).toContainText('Břeclav');

  // Either real departures or the explicit empty-state message — never a blank panel.
  await expect(
    panel.locator('.departures tr').first().or(panel.locator('.empty')),
  ).toBeVisible();
});
```

If `breclav-autobusove-nadrazi` is not a real slug in the generated data, read the actual id from `public/data/current/network.json` and use that.

- [ ] **Step 4: Run the test**

Run: `npm run test:e2e`
Expected: 1 passing.

- [ ] **Step 5: Add it to CI**

In `.github/workflows/deploy.yml`, insert these two steps in the `build` job between `npm test` and `npm run build`:

```yaml
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
```

- [ ] **Step 6: Commit and push**

```bash
git add playwright.config.ts e2e package.json package-lock.json .github
git commit -m "test: add end-to-end smoke test and run it in CI"
git push
```

- [ ] **Step 7: Verify the deployment**

Run: `gh run watch`
Then open `https://mrcoft.github.io/Breclav-MHD-Mapa/` and confirm the full map works: lines list, highlight, stop panel, departures, footer attribution.

---

## Deferred, by decision

Recorded so a future session does not mistake these for oversights.

- **Comparison UI** (toggle, split view, or diff overlay between current and proposed networks). The format and the `scenarios.json` list already support more than one scenario; only the UI is missing. Waiting on the proposed network to exist.
- **Parallel-line offsetting.** Where many lines share a street in central Břeclav, routes overlap into a single stroke. Fixing it properly needs segment-level deduplication across patterns and `line-offset` ranking. The line-browser highlight makes the map readable in the meantime.
- **Manual geometry overrides.** Task 12 prints the list of patterns that fell back to straight lines. Working through that list is ongoing maintenance, not a blocking task.
- **Basemap-failure resilience.** The spec claims routes and stops still render if OpenFreeMap is unreachable. As built, layer installation waits on the map's `load` event, which a failed style fetch never fires — so the map would stay blank rather than degrading to routes on an empty background. Making this true needs a local fallback style object installed on `error`. Left undone deliberately: it is a rare failure mode and the fix is a self-contained change to `MapView`.
