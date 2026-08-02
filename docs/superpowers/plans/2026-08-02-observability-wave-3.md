# Observability Wave 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the human quality signal to A.I.R. — a rating on grounded answers and a dispute on declines — and move the telemetry code into packages so the Worker, the browser and the eval harness share one redactor.

**Architecture:** Split along the runtime seam. `@eddie/telemetry-core` is pure and dependency-free, running unchanged in workerd and Node; `@eddie/telemetry-client` wraps posthog-js for the browser, where Surveys is not worth reimplementing. `web-astro` becomes wiring only and imports no PostHog symbol.

**Tech Stack:** Nx 23, Yarn 3 workspaces, Vitest, Astro 7, React 19, posthog-js, Cloudflare Workers.

**Design doc:** `docs/superpowers/specs/2026-08-02-observability-wave-3-design.md`

## Global Constraints

- **Autocapture must never be enabled.** `ResumeDownload.tsx` renders download hrefs whose tokens decode to the requester's email. Enforced by a test, not a convention.
- **Every payload passes through `redact`** before reaching any transport or SDK.
- **Content typed to get an answer** (questions) → `ai_events`, 30-day retention. **Content volunteered as feedback** (comments) → may be retained.
- **`persistence: 'memory'`** — no cookie, no localStorage, no consent banner.
- **Telemetry must never break a request.** Never throws, never blocks; unconfigured is a no-op.
- **Survey ids are fixed** and live in `events.mjs`, never inline:
  - `air-answer-quality` = `019fc122-7de8-0000-7fa8-0bf8842ad239`
  - `air-decline-dispute` = `019fc122-9c54-0000-b9ef-9a66c58aef0b`
- **Push over SSH** when a commit touches `.github/workflows/` — HTTPS is rejected without the `workflow` scope.
- **Stage files explicitly.** Never `git add -A`; parallel work is often in the tree.

---

## Slice A — Extraction

Lands as one PR. No behaviour change: if a moved spec needs editing to pass, the
extraction is wrong.

### Task 1: Make CI see every project

**Why first.** `yarn ci` and the workflow both scope to `--projects=web-astro`.
`obsidian-publish-core` has **43 tests that have never run in CI**, and moving
telemetry into a package would silently drop its 42 specs out of enforcement
too. That is the same failure shape as the A.I.R. evals skipping for months.
Fixing the scope before the move means the extraction is protected the moment it
lands.

**Files:**
- Modify: `package.json` (the `ci` script)
- Modify: `.github/workflows/ci.yml:61-64`

**Interfaces:**
- Consumes: nothing
- Produces: a CI that runs `lint` and `test` for every Nx project

- [ ] **Step 1: Confirm the blind spot is real**

```bash
npx nx test obsidian-publish-core 2>&1 | grep -E 'Tests|Test Files'
```

Expected: `Tests 43 passed (43)` — 43 tests that CI does not currently run.

- [ ] **Step 2: Widen the `ci` script**

In `package.json`, change the `ci` script from:

```json
"ci": "nx run-many --targets=check,lint,test,build --projects=web-astro"
```

to:

```json
"ci": "nx run-many --targets=check,lint,test,build"
```

Omitting `--projects` runs every project that defines the target. Nx skips
projects without it, so `check` and `build` still only apply to `web-astro`.

- [ ] **Step 3: Widen the workflow**

In `.github/workflows/ci.yml`, replace lines 61 and 64:

```yaml
      - name: Lint
        run: yarn nx run-many --targets=lint

      - name: Test
        run: yarn nx run-many --targets=test
```

Add a comment above the Lint step:

```yaml
      # Every project, not just web-astro. Scoping this to one project meant
      # obsidian-publish-core's 43 tests never ran in CI, and would have meant
      # the telemetry specs going quiet the moment they moved into a package.
```

- [ ] **Step 4: Verify locally**

```bash
yarn ci 2>&1 | tail -20
```

Expected: `Successfully ran targets check, lint, test, build`, and the output
mentions both `web-astro` and `obsidian-publish-core`.

- [ ] **Step 5: Commit and push over SSH**

```bash
git add package.json .github/workflows/ci.yml
git commit -m "ci: run every project's tests, not just web-astro's

obsidian-publish-core has 43 tests that have never run in CI, because both the
ci script and the workflow scoped to --projects=web-astro. Nobody noticed
because nothing failed — the same shape as the A.I.R. evals, which skipped
silently for months while a real regression landed behind them.

Fixed before the telemetry extraction rather than after, so its 42 specs are
protected the moment they move out of web-astro."
git push
```

---

### Task 2: Extract `@eddie/telemetry-core`

**Files:**
- Create: `packages/telemetry-core/package.json`
- Create: `packages/telemetry-core/project.json`
- Create: `packages/telemetry-core/vitest.config.mts`
- Create: `packages/telemetry-core/eslint.config.mjs`
- Move: `packages/web-astro/src/util/telemetry/{index,llm,redact,transport}.mjs` → `packages/telemetry-core/src/`
- Move: `packages/web-astro/src/util/telemetry/{index,llm,redact,transport}.spec.ts` → `packages/telemetry-core/src/`
- Modify: `packages/web-astro/src/pages/api/air/ask.ts:19`

**Interfaces:**
- Consumes: Task 1's CI scope
- Produces: `@eddie/telemetry-core` exporting `createTelemetry(env, options)`, `OUTCOMES`, and subpaths `./redact`, `./llm`, `./transport`

**Context you need.** `web-astro` has **no `package.json`** — it is not a Yarn
workspace member, and its dependencies come from the root. `@eddie/*` resolves
through a symlink in root `node_modules/` that Yarn creates for any workspace
package. So creating the package and running `yarn install` is all the wiring
there is; no dependency line to add anywhere.

The only import site in the whole repo is `ask.ts:19`. `constants.ts` and
`privacy.astro` match the word "telemetry" but in an unrelated badge label and a
comment.

- [ ] **Step 1: Record the baseline**

```bash
npx vitest run --root packages/web-astro src/util/telemetry 2>&1 | grep -E 'Tests|Test Files'
```

Expected: `Tests 42 passed (42)`. Write that number down — it is the contract for
this task.

- [ ] **Step 2: Create the package manifest**

`packages/telemetry-core/package.json`:

```json
{
  "name": "@eddie/telemetry-core",
  "version": "0.1.0",
  "private": true,
  "description": "Telemetry primitives for A.I.R. Pure and dependency-free so the same redactor runs in workerd, in Node, and in the browser adapter.",
  "license": "MIT",
  "type": "module",
  "main": "./src/index.mjs",
  "exports": {
    ".": "./src/index.mjs",
    "./redact": "./src/redact.mjs",
    "./llm": "./src/llm.mjs",
    "./transport": "./src/transport.mjs"
  },
  "files": ["src"],
  "sideEffects": false
}
```

- [ ] **Step 3: Create the Nx project**

`packages/telemetry-core/project.json`:

```json
{
  "name": "telemetry-core",
  "$schema": "../../node_modules/nx/schemas/project-schema.json",
  "projectType": "library",
  "sourceRoot": "packages/telemetry-core/src",
  "tags": [],
  "targets": {
    "test": {
      "executor": "nx:run-commands",
      "cache": true,
      "options": {
        "command": "vitest run",
        "cwd": "packages/telemetry-core"
      },
      "configurations": { "watch": { "command": "vitest" } }
    },
    "lint": {
      "executor": "@nx/eslint:lint",
      "outputs": ["{options.outputFile}"],
      "options": {
        "lintFilePatterns": ["packages/telemetry-core/**/*.{js,mjs,ts}"]
      }
    }
  }
}
```

- [ ] **Step 4: Create the test and lint configs**

`packages/telemetry-core/vitest.config.mts`:

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

// No jsdom. This package is pure and must stay Node-free so the identical code
// runs in workerd, and so the browser adapter can import its redactor.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,mjs}'],
  },
});
```

`packages/telemetry-core/eslint.config.mjs`:

```js
import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.{js,mjs,ts}'],
    rules: {},
  },
];
```

- [ ] **Step 5: Move the source, preserving history**

```bash
mkdir -p packages/telemetry-core/src
git mv packages/web-astro/src/util/telemetry/index.mjs      packages/telemetry-core/src/index.mjs
git mv packages/web-astro/src/util/telemetry/llm.mjs        packages/telemetry-core/src/llm.mjs
git mv packages/web-astro/src/util/telemetry/redact.mjs     packages/telemetry-core/src/redact.mjs
git mv packages/web-astro/src/util/telemetry/transport.mjs  packages/telemetry-core/src/transport.mjs
git mv packages/web-astro/src/util/telemetry/index.spec.ts      packages/telemetry-core/src/index.spec.ts
git mv packages/web-astro/src/util/telemetry/llm.spec.ts        packages/telemetry-core/src/llm.spec.ts
git mv packages/web-astro/src/util/telemetry/redact.spec.ts     packages/telemetry-core/src/redact.spec.ts
git mv packages/web-astro/src/util/telemetry/transport.spec.ts  packages/telemetry-core/src/transport.spec.ts
rmdir packages/web-astro/src/util/telemetry
```

**Do not edit any moved file.** Every import inside them is relative
(`./redact.mjs`, `./llm.mjs`) and stays valid.

- [ ] **Step 6: Link the workspace**

```bash
CYPRESS_INSTALL_BINARY=0 yarn install
ls -la node_modules/@eddie/
```

Expected: a `telemetry-core -> ../../packages/telemetry-core` symlink alongside
`obsidian-publish-core`.

- [ ] **Step 7: Run the moved specs unedited**

```bash
npx nx test telemetry-core 2>&1 | grep -E 'Tests|Test Files'
```

Expected: `Tests 42 passed (42)` — the same number as Step 1, with no file
edited. If any spec needed changing to pass, stop: the move altered behaviour.

- [ ] **Step 8: Rewire the one consumer**

In `packages/web-astro/src/pages/api/air/ask.ts`, change line 19 from:

```ts
import { createTelemetry } from '@util/telemetry/index.mjs';
```

to:

```ts
import { createTelemetry } from '@eddie/telemetry-core';
```

- [ ] **Step 9: Type-check, and apply the fallback if needed**

```bash
npx nx check web-astro 2>&1 | tail -20
```

Expected: `0 errors`.

`ask.ts:90-91` uses `Parameters<typeof telemetry.captureTrace>[0]['retrieval']`.
If TypeScript cannot resolve types through the package `exports` map, that line
errors rather than degrading to `any`. **If and only if Step 9 reports an error**,
add `packages/telemetry-core/src/index.d.ts`:

```ts
export { OUTCOMES } from './llm.mjs';

export interface RetrievalSpanInput {
  traceId: string;
  retrievedIds: string[];
  topScore?: number;
  floorCleared: boolean;
  ms?: number;
}

export interface Telemetry {
  capture(event: string, properties?: Record<string, unknown>): void;
  captureTrace(input: {
    trace: Record<string, unknown>;
    retrieval?: RetrievalSpanInput;
    generation?: Record<string, unknown>;
  }): void;
  recordError(error: unknown, context?: Record<string, unknown>): void;
  alert(severity: string, message: string, fields?: Record<string, unknown>): void;
  flush(): Promise<void>;
}

export function createTelemetry(
  env: Record<string, unknown> | undefined,
  options?: {
    fetchImpl?: typeof fetch;
    waitUntil?: (promise: Promise<unknown>) => void;
    distinctId?: string;
  },
): Telemetry;
```

and add `"types": "./src/index.d.ts"` to the package manifest. Re-run Step 9.

- [ ] **Step 10: Full verification**

```bash
yarn ci 2>&1 | tail -12
```

Expected: `Successfully ran targets check, lint, test, build`, with
`telemetry-core` among the projects.

- [ ] **Step 11: Commit**

```bash
git add packages/telemetry-core packages/web-astro/src/pages/api/air/ask.ts
git commit -m "refactor: extract @eddie/telemetry-core

Moves the telemetry seam out of web-astro so the Worker, the browser adapter and
scripts/air-eval.mjs share one redactor. redact.mjs is the choke point every
event passes through; two copies of it would be two guarantees, and only one of
them tested.

The 42 specs moved unedited. That is the contract for this change: if one had
needed a change to pass, the extraction would have altered behaviour rather than
relocating it.

Mirrors @eddie/obsidian-publish-core, which already makes the same claim about
running unchanged in Node and workerd. web-astro has no package.json of its own,
so the workspace symlink is the whole of the wiring."
git push
```

---

## Slice B — The browser adapter

### Task 3: Scaffold `@eddie/telemetry-client` with a no-op default

**Files:**
- Create: `packages/telemetry-client/package.json`
- Create: `packages/telemetry-client/project.json`
- Create: `packages/telemetry-client/vitest.config.mts`
- Create: `packages/telemetry-client/eslint.config.mjs`
- Create: `packages/telemetry-client/src/index.mjs`
- Test: `packages/telemetry-client/src/index.spec.ts`

**Interfaces:**
- Consumes: `@eddie/telemetry-core` (`./redact`)
- Produces: `createNoopClient()` and the `TelemetryClient` shape — `init(config)`, `pageview(route)`, `capture(event, props)`, `surveyShown(surveyId, traceId)`, `surveySent(surveyId, traceId, responses)`

- [ ] **Step 1: Write the failing test**

`packages/telemetry-client/src/index.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createNoopClient } from './index.mjs';

/**
 * The default implementation does nothing, and that is the point. Every call
 * site must work before anything is configured — the same guarantee
 * createTransport makes server-side. Telemetry is never the reason something
 * breaks.
 */
describe('createNoopClient', () => {
  it('answers every method without throwing', () => {
    const client = createNoopClient();

    expect(() => client.init({ token: 'x' })).not.toThrow();
    expect(() => client.pageview('/cv')).not.toThrow();
    expect(() => client.capture('anything', { a: 1 })).not.toThrow();
    expect(() => client.surveyShown('s', 't')).not.toThrow();
    expect(() => client.surveySent('s', 't', {})).not.toThrow();
  });

  it('reports that it is not active', () => {
    expect(createNoopClient().active).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run --root packages/telemetry-client src/index.spec.ts
```

Expected: FAIL — cannot resolve `./index.mjs`.

- [ ] **Step 3: Create the package files**

`packages/telemetry-client/package.json`:

```json
{
  "name": "@eddie/telemetry-client",
  "version": "0.1.0",
  "private": true,
  "description": "Browser telemetry for the portfolio. The interface plus a PostHog adapter, so no consumer imports posthog-js directly.",
  "license": "MIT",
  "type": "module",
  "main": "./src/index.mjs",
  "exports": {
    ".": "./src/index.mjs",
    "./posthog": "./src/posthog.mjs"
  },
  "files": ["src"],
  "sideEffects": false,
  "dependencies": {
    "posthog-js": "^1.281.0"
  }
}
```

`packages/telemetry-client/project.json` — identical to Task 2 Step 3 with
`telemetry-core` replaced by `telemetry-client` throughout.

`packages/telemetry-client/vitest.config.mts`:

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

// jsdom, unlike telemetry-core: this half runs in a browser and the adapter
// is tested against a fake posthog object.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,mjs}'],
  },
});
```

`packages/telemetry-client/eslint.config.mjs` — identical to Task 2 Step 4.

- [ ] **Step 4: Write the interface and the no-op**

`packages/telemetry-client/src/index.mjs`:

```js
/**
 * Browser telemetry, as an interface with a default that does nothing.
 *
 * The no-op is not a convenience. Every call site must work before anything is
 * configured, so an unset key, a blocked script or a failed import degrades to
 * silence rather than to a broken page. That is the guarantee `createTransport`
 * already makes in the Worker, held to on this side too.
 *
 * @typedef {object} TelemetryClient
 * @property {boolean} active
 * @property {(config: {token: string, host?: string}) => void} init
 * @property {(route: string) => void} pageview
 * @property {(event: string, properties?: Record<string, unknown>) => void} capture
 * @property {(surveyId: string, traceId: string) => void} surveyShown
 * @property {(surveyId: string, traceId: string, responses: Record<string, unknown>) => void} surveySent
 */

/** @returns {TelemetryClient} */
export function createNoopClient() {
  return {
    active: false,
    init() {},
    pageview() {},
    capture() {},
    surveyShown() {},
    surveySent() {},
  };
}
```

- [ ] **Step 5: Run the test**

```bash
npx vitest run --root packages/telemetry-client src/index.spec.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Install and commit**

```bash
CYPRESS_INSTALL_BINARY=0 yarn install
git add packages/telemetry-client package.json yarn.lock
git commit -m "feat: scaffold @eddie/telemetry-client with a no-op default

The interface first, and a default implementation that does nothing. An unset
key or a blocked script has to degrade to silence rather than to a broken page,
which is the guarantee createTransport already makes in the Worker."
git push
```

---

### Task 4: The PostHog adapter, with autocapture nailed shut

**Files:**
- Create: `packages/telemetry-client/src/posthog.mjs`
- Test: `packages/telemetry-client/src/posthog.spec.ts`

**Interfaces:**
- Consumes: `createNoopClient` from Task 3, `redact` from `@eddie/telemetry-core/redact`
- Produces: `createPostHogClient(posthogLike)` returning a `TelemetryClient`

- [ ] **Step 1: Write the failing tests**

`packages/telemetry-client/src/posthog.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createPostHogClient } from './posthog.mjs';

function fakePosthog() {
  return {
    init: vi.fn(),
    capture: vi.fn(),
    set_config: vi.fn(),
  };
}

describe('createPostHogClient', () => {
  /*
   * The most important test in this package.
   *
   * ResumeDownload.tsx renders download URLs as visible <a href> fallbacks
   * whose tokens decode to the requester's email, and autocapture records the
   * href of every click. A config flag is the only thing between that and
   * sending a stranger's address to a third party. This makes it structural.
   */
  it('never enables autocapture or session recording', () => {
    const posthog = fakePosthog();
    createPostHogClient(posthog).init({ token: 'phc_test' });

    const [, config] = posthog.init.mock.calls[0];
    expect(config.autocapture).toBe(false);
    expect(config.disable_session_recording).toBe(true);
  });

  it('stores nothing on the visitor’s device', () => {
    // persistence: 'memory' is what keeps consent out of scope. If this
    // regresses, the site needs a cookie banner and nobody will notice it does.
    const posthog = fakePosthog();
    createPostHogClient(posthog).init({ token: 'phc_test' });

    expect(posthog.init.mock.calls[0][1].persistence).toBe('memory');
  });

  it('redacts an email out of a survey comment', () => {
    const posthog = fakePosthog();
    const client = createPostHogClient(posthog);
    client.init({ token: 'phc_test' });

    client.surveySent('survey-1', 'trace-1', {
      $survey_response_q1: 'mail me at someone@example.com',
    });

    const [, properties] = posthog.capture.mock.calls[0];
    expect(properties.$survey_response_q1).not.toContain('someone@example.com');
  });

  it('attaches the trace id so feedback lands on the trace it judges', () => {
    const posthog = fakePosthog();
    const client = createPostHogClient(posthog);
    client.init({ token: 'phc_test' });

    client.surveyShown('survey-1', 'trace-1');

    expect(posthog.capture).toHaveBeenCalledWith('survey shown', {
      $survey_id: 'survey-1',
      $ai_trace_id: 'trace-1',
    });
  });

  it('does nothing before init, rather than throwing', () => {
    const posthog = fakePosthog();
    const client = createPostHogClient(posthog);

    expect(() => client.capture('too_early')).not.toThrow();
    expect(posthog.capture).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run --root packages/telemetry-client src/posthog.spec.ts
```

Expected: FAIL — cannot resolve `./posthog.mjs`.

- [ ] **Step 3: Write the adapter**

`packages/telemetry-client/src/posthog.mjs`:

```js
import { redact } from '@eddie/telemetry-core/redact';

/**
 * The PostHog adapter.
 *
 * Takes the SDK as an argument rather than importing it, so the tests run
 * against a fake and the consumer decides when the real module is loaded — the
 * site dynamic-imports it, and only when the scope flag says to.
 *
 * @param {{init: Function, capture: Function}} posthog
 * @returns {import('./index.mjs').TelemetryClient}
 */
export function createPostHogClient(posthog) {
  let ready = false;

  const send = (event, properties) => {
    if (!ready) return;
    posthog.capture(event, redact(properties ?? {}));
  };

  return {
    get active() {
      return ready;
    },

    init({ token, host = 'https://us.i.posthog.com' }) {
      posthog.init(token, {
        api_host: host,
        // Never. See posthog.spec.ts — download hrefs carry tokens that decode
        // to a requester's email, and autocapture records clicked hrefs.
        autocapture: false,
        disable_session_recording: true,
        // No cookie, no localStorage, so no consent banner. The cost is
        // identity continuity across page loads, which is a accepted trade.
        persistence: 'memory',
        // Bound to astro:page-load by the consumer instead, because a view
        // transition is not a page load.
        capture_pageview: false,
      });
      ready = true;
    },

    pageview(route) {
      send('$pageview', { $current_url: route });
    },

    capture(event, properties) {
      send(event, properties);
    },

    surveyShown(surveyId, traceId) {
      send('survey shown', { $survey_id: surveyId, $ai_trace_id: traceId });
    },

    surveySent(surveyId, traceId, responses) {
      send('survey sent', {
        $survey_id: surveyId,
        $ai_trace_id: traceId,
        ...responses,
      });
    },
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
npx nx test telemetry-client
```

Expected: PASS, 7 tests across both spec files.

- [ ] **Step 5: Commit**

```bash
git add packages/telemetry-client/src/posthog.mjs packages/telemetry-client/src/posthog.spec.ts
git commit -m "feat: add the PostHog adapter, with autocapture nailed shut

Takes the SDK as an argument rather than importing it, so the tests run against
a fake and the site decides when the real module loads.

The autocapture assertion is the one that matters. ResumeDownload renders
download hrefs whose tokens decode to the requester's email, and autocapture
records clicked hrefs — a config flag was the only thing between that and
handing a stranger's address to a third party. Now a test is."
git push
```

---

## Slice C — Wave 3 behaviour

### Task 5: The event contract

**Files:**
- Create: `packages/telemetry-core/src/events.mjs`
- Test: `packages/telemetry-core/src/events.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `SURVEYS` (`{ answerQuality: {id, questions}, declineDispute: {id, questions} }`) and `EVENTS` (`{ resumeFormOpened, resumeDownloadTriggered }`)

- [ ] **Step 1: Write the failing test**

`packages/telemetry-core/src/events.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SURVEYS, EVENTS } from './events.mjs';

/**
 * One place that names every event. This is what stops air_answer_rated
 * drifting into air_rating_submitted between a call site and a dashboard, and
 * it is why the survey ids are not inline in a React component.
 */
describe('the event contract', () => {
  it('carries the provisioned survey ids', () => {
    expect(SURVEYS.answerQuality.id).toBe('019fc122-7de8-0000-7fa8-0bf8842ad239');
    expect(SURVEYS.declineDispute.id).toBe('019fc122-9c54-0000-b9ef-9a66c58aef0b');
  });

  it('keys responses by question id, which is how PostHog stores them', () => {
    // Responses arrive as $survey_response_<question_id>. Getting this wrong
    // produces a survey with responses that never render against it.
    expect(SURVEYS.answerQuality.questions.helpful).toMatch(/^[0-9a-f-]{36}$/);
    expect(SURVEYS.declineDispute.questions.expected).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('is frozen, so a call site cannot rename an event at runtime', () => {
    expect(Object.isFrozen(SURVEYS)).toBe(true);
    expect(Object.isFrozen(EVENTS)).toBe(true);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run --root packages/telemetry-core src/events.spec.ts
```

Expected: FAIL — cannot resolve `./events.mjs`.

- [ ] **Step 3: Write the contract**

`packages/telemetry-core/src/events.mjs`:

```js
/**
 * Every event this site emits, named once.
 *
 * The `$ai_*` triad is not here — `llm.mjs` owns it and keeps it. This covers
 * everything else, and exists so an event name is defined in one place rather
 * than typed at a call site and again in a dashboard.
 *
 * Survey ids are PostHog objects created ahead of the code. Responses are keyed
 * `$survey_response_<question_id>`, which makes the question ids load-bearing
 * rather than incidental.
 */
export const SURVEYS = Object.freeze({
  /** Shown only when `grounded: true`. */
  answerQuality: Object.freeze({
    id: '019fc122-7de8-0000-7fa8-0bf8842ad239',
    questions: Object.freeze({
      helpful: '4c346a19-26ed-47e8-b6b9-6c4ea7596917',
      whatWasWrong: 'a8c1f487-4475-4e8d-9c03-a79008825840',
    }),
  }),

  /**
   * Shown only when `grounded: false`. Sending it *is* the dispute: its one
   * question is optional so a click alone records, because requiring a sentence
   * would cost most of the signal.
   */
  declineDispute: Object.freeze({
    id: '019fc122-9c54-0000-b9ef-9a66c58aef0b',
    questions: Object.freeze({
      expected: '0c0d27ee-f089-4d6a-9f65-293860c2fbf7',
    }),
  }),
});

export const EVENTS = Object.freeze({
  resumeFormOpened: 'resume_form_opened',
  resumeDownloadTriggered: 'resume_download_triggered',
});
```

- [ ] **Step 4: Run the test, then commit**

```bash
npx nx test telemetry-core
git add packages/telemetry-core/src/events.mjs packages/telemetry-core/src/events.spec.ts
git commit -m "feat: name every event once, in the package both runtimes import"
git push
```

---

### Task 6: Record the question on a declined retrieval

**Files:**
- Modify: `packages/telemetry-core/src/llm.mjs` (`buildRetrievalSpan`)
- Modify: `packages/telemetry-core/src/llm.spec.ts`
- Modify: `packages/web-astro/src/pages/api/air/ask.ts:247`

**Interfaces:**
- Consumes: `buildRetrievalSpan` from Task 2's moved module
- Produces: a retrieval span carrying `question` when `retrievedIds` is empty

- [ ] **Step 1: Write the failing tests**

Append to `packages/telemetry-core/src/llm.spec.ts`:

```ts
describe('a declined retrieval records what was asked', () => {
  /*
   * A decline never calls the model, so no generation exists and the question
   * is otherwise recorded nowhere. Spans are $ai_span, so this lands in
   * ai_events under the same 30-day content retention as every other question —
   * no new retention category, and the permanent events table stays free of
   * anyone's prose.
   */
  it('carries the question when nothing was retrieved', () => {
    const span = buildRetrievalSpan({
      traceId: 't1',
      retrievedIds: [],
      floorCleared: false,
      question: 'How does he handle incidents?',
    });

    expect(span.properties.question).toBe('How does he handle incidents?');
  });

  it('omits the question when retrieval succeeded', () => {
    // A grounded question already rides on the generation. Putting it here too
    // would write the same content twice for one dataset.
    const span = buildRetrievalSpan({
      traceId: 't1',
      retrievedIds: ['platform-migration'],
      floorCleared: true,
      question: 'How does he handle incidents?',
    });

    expect(span.properties.question).toBeUndefined();
  });

  it('redacts the question, like every other free text', () => {
    const span = buildRetrievalSpan({
      traceId: 't1',
      retrievedIds: [],
      floorCleared: false,
      question: 'reach me at someone@example.com',
    });

    expect(span.properties.question).not.toContain('someone@example.com');
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx nx test telemetry-core
```

Expected: FAIL — `span.properties.question` is `undefined` in the first test.

- [ ] **Step 3: Implement**

In `packages/telemetry-core/src/llm.mjs`, add `question` to the `buildRetrievalSpan`
JSDoc input and set it conditionally inside `properties`:

```js
      // Only when nothing was retrieved. A grounded question already rides on
      // the generation, and a decline calls no model — so without this, the
      // questions the corpus cannot reach are the only ones never recorded.
      // Redacted like all free text; lands in ai_events under 30-day retention.
      ...(input.retrievedIds.length === 0 && input.question
        ? { question: redact(input.question) }
        : {}),
```

`redact` is already imported at the top of `llm.mjs`.

- [ ] **Step 4: Run the tests**

```bash
npx nx test telemetry-core
```

Expected: PASS.

- [ ] **Step 5: Pass the question from the endpoint**

In `packages/web-astro/src/pages/api/air/ask.ts:247`, change:

```ts
      { retrieval: { traceId, retrievedIds: [], floorCleared: false } },
```

to:

```ts
      { retrieval: { traceId, retrievedIds: [], floorCleared: false, question } },
```

- [ ] **Step 6: Verify and commit**

```bash
yarn ci 2>&1 | tail -8
git add packages/telemetry-core/src/llm.mjs packages/telemetry-core/src/llm.spec.ts packages/web-astro/src/pages/api/air/ask.ts
git commit -m "feat: record what was asked when retrieval declines

A decline calls no model, so no generation exists and the question was recorded
nowhere — which made the questions the corpus cannot reach the only ones we
could not read. On the span it lands in ai_events under the same 30-day
retention as every other question, so the permanent events table stays free of
anyone's prose."
git push
```

---

### Task 7: The scope flag

**Files:**
- Modify: `packages/web-astro/src/util/flags/sections.mjs`
- Modify: `packages/web-astro/src/util/flags/sections.spec.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `resolveSections(...).analyticsSiteWide` — boolean

- [ ] **Step 1: Write the failing tests**

Append to `packages/web-astro/src/util/flags/sections.spec.ts`:

```ts
describe('the analytics scope switch', () => {
  it('defaults to feedback-only when the env says nothing', () => {
    // The cheaper and more private default. Site-wide is opted into.
    expect(buildTimeSections({}).analyticsSiteWide).toBe(false);
  });

  it('compiles site-wide in from the environment', () => {
    expect(
      buildTimeSections({ PUBLIC_ANALYTICS_SITE_WIDE: 'true' }).analyticsSiteWide,
    ).toBe(true);
  });

  it('lets a runtime flag flip it without a deploy', () => {
    const resolved = applyOverrides(buildTimeSections({}), {
      'analytics-site-wide': true,
    });

    expect(resolved.analyticsSiteWide).toBe(true);
  });

  it('ignores a string variant, like every other section flag', () => {
    // applyOverrides already documents this: only a real boolean counts, so a
    // missing flag or a variant leaves the compiled value alone.
    const resolved = applyOverrides(
      buildTimeSections({ PUBLIC_ANALYTICS_SITE_WIDE: 'true' }),
      { 'analytics-site-wide': 'yes' },
    );

    expect(resolved.analyticsSiteWide).toBe(true);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run --root packages/web-astro src/util/flags/sections.spec.ts
```

Expected: FAIL — `analyticsSiteWide` is `undefined`.

- [ ] **Step 3: Implement**

In `sections.mjs`, add to the `SECTION_FLAGS` neighbourhood:

```js
/** Whether analytics loads on every route, or only where feedback happens. */
export const ANALYTICS_SITE_WIDE_FLAG = 'analytics-site-wide';
```

In `buildTimeSections`, beside `analytics`:

```js
    // Scope, not presence. `analytics` says whether there is a key at all; this
    // says whether every route pays for it or only the pages that collect
    // feedback. Resolved server-side, so the choice is made before a byte ships.
    analyticsSiteWide: env.PUBLIC_ANALYTICS_SITE_WIDE === 'true',
```

In `applyOverrides`, before the `collectsData` block:

```js
    const siteWide = flags[ANALYTICS_SITE_WIDE_FLAG];
    if (typeof siteWide === 'boolean') resolved.analyticsSiteWide = siteWide;
```

- [ ] **Step 4: Run, verify, commit**

```bash
npx vitest run --root packages/web-astro src/util/flags/sections.spec.ts
git add packages/web-astro/src/util/flags/sections.mjs packages/web-astro/src/util/flags/sections.spec.ts
git commit -m "feat: make the analytics scope a flag, resolved server-side

Site-wide and feedback-only are both wanted, so it is a switch rather than a
decision. It resolves in Layout's existing resolveSections await, which means
the choice is made before a byte ships — a client-side check would have
downloaded the SDK before deciding not to use it."
git push
```

---

### Task 8: Wire the adapter into the site

**Files:**
- Modify: `packages/web-astro/src/layouts/Layout.astro`
- Create: `packages/web-astro/src/util/telemetry/client.mjs`

**Interfaces:**
- Consumes: `createPostHogClient` (Task 4), `createNoopClient` (Task 3), `resolveSections(...).analyticsSiteWide` (Task 7)
- Produces: `getClient()` — a module-scope singleton returning the live client or the no-op

- [ ] **Step 1: Write the loader**

`packages/web-astro/src/util/telemetry/client.mjs`:

```js
import { createNoopClient } from '@eddie/telemetry-client';

/**
 * Resolves the browser telemetry client, once per page session.
 *
 * The SDK is dynamic-imported so it is absent from the bundle of every route
 * that does not need it, and so a blocked or failed load degrades to the no-op
 * rather than to a broken page.
 */
let client = createNoopClient();
let loading = null;

export function getClient() {
  return client;
}

/**
 * @param {{token: string, host?: string}} config
 * @returns {Promise<import('@eddie/telemetry-client').TelemetryClient>}
 */
export function loadClient(config) {
  if (client.active) return Promise.resolve(client);
  if (loading) return loading;

  loading = Promise.all([
    import('posthog-js'),
    import('@eddie/telemetry-client/posthog'),
  ])
    .then(([{ default: posthog }, { createPostHogClient }]) => {
      const live = createPostHogClient(posthog);
      live.init(config);
      client = live;
      return client;
    })
    .catch(() => client);

  return loading;
}
```

- [ ] **Step 2: Bind it in the layout**

In `Layout.astro`, inside the existing `sections` await, expose the values to
the client script, then add:

```astro
{sections.analytics && sections.analyticsSiteWide && (
  <script
    is:inline
    define:vars={{ token: import.meta.env.PUBLIC_POSTHOG_KEY }}
    type="module"
  >
    const { loadClient, getClient } = await import('/src/util/telemetry/client.mjs');
    // astro:page-load, not module scope: a view transition swaps the document
    // without re-running module-scope code, so a pageview would be missed on
    // every navigation after the first.
    document.addEventListener('astro:page-load', async () => {
      await loadClient({ token });
      getClient().pageview(window.location.pathname);
    });
  </script>
)}
```

- [ ] **Step 3: Verify the gate holds**

```bash
PUBLIC_POSTHOG_KEY= npx nx build web-astro && \
  grep -rc 'posthog' packages/web-astro/dist/client/ | grep -v ':0' | head
```

Expected: no output — with no key, nothing PostHog-related reaches the client
bundle.

- [ ] **Step 4: Commit**

```bash
git add packages/web-astro/src/util/telemetry/client.mjs packages/web-astro/src/layouts/Layout.astro
git commit -m "feat: load the telemetry client, gated on the scope flag

Dynamic-imported so the SDK is absent from routes that do not need it, and so a
blocked load degrades to the no-op rather than a broken page. Bound to
astro:page-load because a view transition swaps the document without re-running
module scope, which would miss every navigation after the first."
git push
```

---

### Task 9: The rating and the dispute

**Files:**
- Create: `packages/web-astro/src/react/AnswerFeedback.tsx`
- Create: `packages/web-astro/src/react/AnswerFeedback.spec.tsx`
- Modify: `packages/web-astro/src/react/AIResume.tsx` (the `Answer` interface at line 19, and the answer block at line 324)

**Interfaces:**
- Consumes: `SURVEYS` (Task 5), `getClient`/`loadClient` (Task 8)
- Produces: `<AnswerFeedback grounded traceId />`

- [ ] **Step 1: Write the failing tests**

`packages/web-astro/src/react/AnswerFeedback.spec.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AnswerFeedback from './AnswerFeedback';

describe('AnswerFeedback', () => {
  it('asks whether a grounded answer helped', () => {
    render(<AnswerFeedback grounded traceId="t1" />);

    expect(screen.getByRole('button', { name: /yes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /no/i })).toBeInTheDocument();
  });

  it('offers a dispute instead when the answer was a decline', () => {
    // Never the rating widget. "This was wrong" and "there was nothing here"
    // are opposite failures, and one control would blend them.
    render(<AnswerFeedback grounded={false} traceId="t1" />);

    expect(
      screen.getByRole('button', { name: /should be able to answer/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^yes$/i })).toBeNull();
  });

  it('records a dispute on the click alone, before any comment', () => {
    // Requiring a sentence would cost most of the signal.
    const client = { surveySent: vi.fn(), surveyShown: vi.fn(), active: true };
    render(<AnswerFeedback grounded={false} traceId="t1" client={client} />);

    return userEvent
      .click(screen.getByRole('button', { name: /should be able to answer/i }))
      .then(() => {
        expect(client.surveySent).toHaveBeenCalledWith(
          '019fc122-9c54-0000-b9ef-9a66c58aef0b',
          't1',
          expect.any(Object),
        );
      });
  });

  it('asks what was wrong only after a thumbs-down', () => {
    const client = { surveySent: vi.fn(), surveyShown: vi.fn(), active: true };
    render(<AnswerFeedback grounded traceId="t1" client={client} />);

    return userEvent.click(screen.getByRole('button', { name: /no/i })).then(() => {
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });
  });

  it('thanks and stops after a thumbs-up, asking nothing further', () => {
    const client = { surveySent: vi.fn(), surveyShown: vi.fn(), active: true };
    render(<AnswerFeedback grounded traceId="t1" client={client} />);

    return userEvent.click(screen.getByRole('button', { name: /yes/i })).then(() => {
      expect(screen.queryByRole('textbox')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run --root packages/web-astro src/react/AnswerFeedback.spec.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AnswerFeedback.tsx`**

```tsx
import React from 'react';
import { SURVEYS } from '@eddie/telemetry-core/events';
import { getClient } from '@util/telemetry/client.mjs';

interface Props {
  grounded: boolean;
  traceId: string;
  /** Injected by tests; defaults to whatever the page loaded. */
  client?: {
    surveyShown: (surveyId: string, traceId: string) => void;
    surveySent: (
      surveyId: string,
      traceId: string,
      responses: Record<string, unknown>,
    ) => void;
  };
}

/**
 * The one signal instrumentation cannot infer: was the answer any good.
 *
 * Two surveys, never one control. A bad answer and a decline are opposite
 * failures — "this was wrong" versus "there was nothing here" — and a single
 * widget would put them in one field, after which telling them apart depends on
 * everyone remembering to filter.
 */
export default function AnswerFeedback({ grounded, traceId, client }: Props) {
  const survey = grounded ? SURVEYS.answerQuality : SURVEYS.declineDispute;
  const telemetry = client ?? getClient();

  const [stage, setStage] = React.useState<'ask' | 'comment' | 'done'>('ask');
  const [comment, setComment] = React.useState('');

  React.useEffect(() => {
    telemetry.surveyShown(survey.id, traceId);
    // Once per answer. Re-firing on every render would skew impression rates,
    // which PostHog already warns is hard to deduplicate.
  }, [survey.id, traceId]);

  const send = (responses: Record<string, unknown>) => {
    telemetry.surveySent(survey.id, traceId, responses);
  };

  if (stage === 'done') {
    return <p class="text-sm">Thanks — that helps.</p>;
  }

  if (stage === 'comment') {
    const questionId = grounded
      ? SURVEYS.answerQuality.questions.whatWasWrong
      : SURVEYS.declineDispute.questions.expected;

    return (
      <div>
        <label htmlFor="air-feedback-comment">
          {grounded ? 'What was wrong with it?' : 'What were you expecting to find?'}
        </label>
        <textarea
          id="air-feedback-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            // Optional by design. An empty comment still submits, because the
            // click already carried the signal.
            if (comment.trim()) send({ [`$survey_response_${questionId}`]: comment });
            setStage('done');
          }}
        >
          Send
        </button>
      </div>
    );
  }

  if (!grounded) {
    return (
      <button
        type="button"
        onClick={() => {
          // Sending IS the dispute. Recorded on the click alone, before any
          // comment — requiring a sentence would cost most of the signal.
          send({});
          setStage('comment');
        }}
      >
        Eddie should be able to answer this
      </button>
    );
  }

  const helpfulId = SURVEYS.answerQuality.questions.helpful;

  return (
    <div>
      <span>Was this helpful?</span>
      <button
        type="button"
        onClick={() => {
          send({ [`$survey_response_${helpfulId}`]: 'Yes' });
          setStage('done');
        }}
      >
        Yes
      </button>
      <button
        type="button"
        onClick={() => {
          send({ [`$survey_response_${helpfulId}`]: 'No' });
          setStage('comment');
        }}
      >
        No
      </button>
    </div>
  );
}
```

Styling is deliberately omitted — match the surrounding `AIResume.tsx` classes
when placing it, rather than inventing a look here.

- [ ] **Step 4: Wire it into `AIResume.tsx`**

Add `traceId: string;` to the `Answer` interface at line 19, and render inside
the existing `{answer && ...}` block at line 324:

```tsx
{answer.traceId && (
  <AnswerFeedback grounded={answer.grounded} traceId={answer.traceId} />
)}
```

- [ ] **Step 5: Run everything and commit**

```bash
yarn ci 2>&1 | tail -8
git add packages/web-astro/src/react/AnswerFeedback.tsx packages/web-astro/src/react/AnswerFeedback.spec.tsx packages/web-astro/src/react/AIResume.tsx
git commit -m "feat: let a visitor say whether the answer was any good

Two controls, never one. A bad answer and a decline are opposite failures, and
rating both with the same widget would put 'this was wrong' and 'there was
nothing here' in one field — after which telling them apart depends on everyone
remembering to filter.

The dispute records on the click alone. Its comment is optional because
requiring a sentence would cost most of the signal, and that signal is the
evidence #69 is waiting on."
git push
```

---

### Task 10: The resume funnel

**Files:**
- Modify: `packages/web-astro/src/react/ResumeDownload.tsx`

**Interfaces:**
- Consumes: `EVENTS` (Task 5), `getClient` (Task 8)
- Produces: nothing downstream

- [ ] **Step 1: Emit on form open and on download**

Add the imports:

```tsx
import { EVENTS } from '@eddie/telemetry-core/events';
import { getClient } from '@util/telemetry/client.mjs';
```

Where the request form is first revealed:

```tsx
        onClick={() => {
          getClient().capture(EVENTS.resumeFormOpened);
          setShowForm(true);
        }}
```

And in the download handler:

```tsx
          // No properties, deliberately. This component's own props are the one
          // place on the site where a token decoding to an email is in scope,
          // so the event carries the funnel step and nothing else.
          getClient().capture(EVENTS.resumeDownloadTriggered);
```

Match the existing handler names in the file rather than renaming them.

- [ ] **Step 2: Verify and commit**

```bash
yarn ci 2>&1 | tail -6
git add packages/web-astro/src/react/ResumeDownload.tsx
git commit -m "feat: count the two steps of the resume funnel

No properties. This component's own props are the one place on the site where a
token decoding to an email is in scope, so the event carries the step and
nothing else."
git push
```

---

### Task 11: The `air-model` flag

**Files:**
- Create: `packages/web-astro/src/util/air/model.mjs`
- Create: `packages/web-astro/src/util/air/model.spec.ts`
- Modify: `packages/web-astro/src/pages/api/air/ask.ts`

**Interfaces:**
- Consumes: `readRuntimeFlags` from `util/flags/client.mjs`
- Produces: `resolveModel(env, options)` → `Promise<string>`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { resolveModel, DEFAULT_MODEL } from './model.mjs';

describe('resolveModel', () => {
  it('falls back to the compiled default when PostHog says nothing', async () => {
    // A network blip must never change which model answers.
    expect(await resolveModel({}, { fetchImpl: async () => { throw new Error('down'); } }))
      .toBe(DEFAULT_MODEL);
  });

  it('ignores a non-string variant', async () => {
    const flags = async () => new Response(JSON.stringify({ flags: { 'air-model': true } }));
    expect(await resolveModel({ PUBLIC_POSTHOG_KEY: 'k' }, { fetchImpl: flags }))
      .toBe(DEFAULT_MODEL);
  });
});
```

- [ ] **Step 2: Implement**

`packages/web-astro/src/util/air/model.mjs`:

```js
import { readRuntimeFlags } from '../flags/client.mjs';

/** What answers when PostHog has no opinion, or cannot be reached. */
export const DEFAULT_MODEL = 'claude-opus-5';

const FLAG = 'air-model';

/**
 * Which model answers, resolved at request time.
 *
 * Comparing models on real traffic needs the model to change without a deploy.
 * Every failure path returns the compiled default, on the same principle as
 * `flags/client.mjs`: a network blip must never change what the site serves.
 *
 * @param {Record<string, unknown>} [env]
 * @param {{ fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<string>}
 */
export async function resolveModel(env = {}, options = {}) {
  const flags = await readRuntimeFlags(env, options);
  const value = flags?.[FLAG];

  // Only a non-empty string counts. A boolean flag, a null, or a missing one
  // means "no opinion" — not "no model".
  return typeof value === 'string' && value.trim() ? value : DEFAULT_MODEL;
}
```

Then in `ask.ts`, replace the `MODEL` constant at its use sites:

```ts
const model = await resolveModel(import.meta.env);
```

and pass `model` everywhere `MODEL` was used — including into `buildTrace`, so
every trace records which model answered it. That property is what makes a
model comparison readable after the fact.

- [ ] **Step 3: Verify and commit**

```bash
yarn ci 2>&1 | tail -6
git add packages/web-astro/src/util/air/model.mjs packages/web-astro/src/util/air/model.spec.ts packages/web-astro/src/pages/api/air/ask.ts
git commit -m "feat: resolve the answering model from a flag

Comparing models on real traffic needs the model to change without a deploy.
Every failure path returns the compiled default, because a network blip must
never change which model answers."
git push
```

---

### Task 12: Make the eval harness emit the same shape production does

**Files:**
- Modify: `scripts/air-eval.mjs`

**Interfaces:**
- Consumes: `createTelemetry` and `buildGeneration` from `@eddie/telemetry-core`
- Produces: nothing downstream

**Why.** This is the reason the extraction was worth doing rather than merely
tidy. `air-eval.mjs` calls real models and grades them; emitting the same
`$ai_generation` shape production emits puts eval runs beside production traces
in the same PostHog views, comparable without a translation step. Today it
reaches across into `web-astro` internals and emits nothing.

- [ ] **Step 1: Wire the telemetry in**

At the top of `scripts/air-eval.mjs`:

```js
import { createTelemetry } from '@eddie/telemetry-core';
```

Where the run is set up:

```js
// Unconfigured is a no-op, so a local run without a key behaves exactly as it
// does today. `run: 'eval'` is what separates these from production traffic in
// every view — without it an eval sweep would look like a traffic spike.
const telemetry = createTelemetry(process.env, {
  distinctId: `air-eval-${process.env.GITHUB_RUN_ID ?? 'local'}`,
});
```

After each graded case, alongside the existing report row:

```js
  telemetry.captureTrace({
    trace: {
      traceId,
      outcome: verdict.pass ? 'answered' : 'verification_failed',
      model,
      grounded: result.grounded,
      questionLength: testCase.question.length,
      run: 'eval',
      caseId: testCase.id,
    },
    generation: buildGenerationInput,
  });
```

and `await telemetry.flush()` before the process exits.

- [ ] **Step 2: Verify it stays silent without a key**

```bash
node scripts/air-eval.mjs --help
```

Expected: no telemetry output, no error. An unconfigured transport is a no-op,
which is the guarantee that lets this run on any machine.

- [ ] **Step 3: Commit**

```bash
git add scripts/air-eval.mjs
git commit -m "feat: emit eval runs as traces, in production's shape

The eval harness calls real models and graded them into a report nobody could
compare against production. Same \$ai_generation shape now, tagged run: 'eval',
so a model sweep sits beside real traffic in the same views instead of in a
markdown file.

This is what the package extraction bought: the harness could not have shared
this code while it lived inside web-astro."
git push
```

---

## Out of scope

Cross-page identity, consent UI, session replay, the embeddings pass (#69 — this
plan produces its input), and automating the dispute→eval-case loop (#77).
