# Split CV Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/cv` into a role chooser that leads to per-role CV variants, each with its own PDFs, and let A.I.R. carry the visitor's role as a retrieval hint.

**Architecture:** One variant slug is the key for everything. A frozen registry (`util/resume/variants.mjs`) names the legal slugs; the loader resolves singleton sections variant-first with fallback to the default; experience entries stay single-source and carry per-variant emphasis overrides. A dynamic route `/cv/[variant]` renders any available variant, `/cv` becomes a chooser built from sealed card copy, and the PDF pipeline iterates the same slugs. A.I.R. gains an optional role that boosts matching entries without filtering anything out.

**Tech Stack:** Astro 7 (SSR on Cloudflare Workers), Content Layer API with Zod, React 19 islands, Tailwind 4, Vitest, Playwright, Nx 23, Yarn 3.

**Spec:** `docs/superpowers/specs/2026-08-08-split-cv-landing-design.md`

## Global Constraints

- **Stage files explicitly.** `git add <path>` only. Never `git add -A` — the working tree carries unrelated in-progress edits (`packages/telemetry/package.json`).
- **Rebase, never merge.** `git fetch origin master && git rebase origin/master && git push --force-with-lease`.
- **Branch:** create `feat/cv-role-variants` off `master` before Task 1. The spec commit `04ae794` currently sits on `content/project-entries`; cherry-pick it onto the new branch.
- **Never commit sealed plaintext.** Real resume prose lives in gitignored `.local-<section>/` directories. Only `sample-*` fixtures and sealed blobs are committed. See `docs/RESUME.md`.
- **Never put a PDF in `public/`.** `scripts/check-gated-assets.mjs` fails the build if one appears. PDFs stay base64 in the Worker bundle.
- **Never put a runtime secret in a build step's `env:`.** `scripts/check-bundle-secrets.mjs` enforces it.
- **Public copy has no AI voice.** No em-dashes, plain sentences, evergreen phrasing, lead with the reader's problem rather than a history. See `docs/VOICE.md`.
- **Resume honesty guardrails** apply to every word of variant copy: no sales quota has ever been carried; agent counts always state both numbers ("17 in production of 27 registered"); in-flight work is described as in flight; Wandering Hearth is concurrent with employment; approximate figures keep their tilde.
- **`resolveSections` is async.** Always `await` it. A missed await yields `undefined`, which fails closed.
- **Content Layer API:** `entry.id` is the slug (never `entry.slug`); render with the top-level `render(entry)`.
- **Fingerprinted files force a PDF regeneration.** Every file in `FINGERPRINTED_FILES` (`src/util/resume/fingerprint.mjs`) is hashed by `pdfs.spec.ts`. Tasks 1 through 7 deliberately touch none of them, so `yarn ci` stays green throughout. Task 8 changes them all at once and Task 10 clears the resulting failure. **Do not push between Task 8 and Task 10.**
- **Run before every commit:** `yarn ci` (`nx run-many --targets=check,lint,test,build --projects=web-astro`).

## Spec decisions that need no task

Recorded so a reader does not go looking for the task that implements them.

- **The A.I.R. corpus needs no change.** Variant singletons are `resume` entries, and `resume` is already in `CORPUS_COLLECTIONS`. They reach retrieval the moment they are sealed, indexed on `title`, `org`, `role`, `tags` and `summary` like every other resume entry. Adding a collection would have duplicated the career in the index.
- **`/cv/air` passes no role.** It is the full chat surface, reached directly rather than from a variant page, so there is nothing truthful to pass. The island accepts a role (Task 7) for the two callers that have one: a variant page, and a seed's lane.
- **The print-notice copy stays as written.** It points at `eddie.engineering/cv`, and the chooser still leads to the downloads in one click.
- **The honesty footer carries no "full CV" link.** On the prototype that link led out of the chat and into the document. Here the cards above it are that link, and a second one would be the same destination said twice.

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `packages/web-astro/src/util/resume/variants.mjs` | The single authoritative list of variant slugs, route paths, PDF filename suffixes, and the `variant:kind` PDF key format. Pure data plus four predicates. No imports. |
| `packages/web-astro/src/util/resume/variants.spec.ts` | Registry invariants: unique slugs, default present, key round-trip. |
| `packages/web-astro/src/util/resume/load.spec.ts` | Loader unit tests: variant fallback, override application, `availableVariants`, `variantCards`. |
| `packages/web-astro/src/pages/cv/[variant].astro` | Renders any available variant. Validates the slug against the registry, 404s otherwise. |
| `packages/web-astro/src/components/cv/RoleCard.astro` | One chooser card. Presentation only. |
| `packages/web-astro/src/react/SeedQuestions.tsx` | Lane-tagged rotating seed questions on the landing. Opens the A.I.R. dialog with a question and a lane. |
| `packages/web-astro/src/react/SeedQuestions.spec.tsx` | Rotation, reduced-motion, and activation behaviour. |
| `packages/web-astro/src/content/resume/{profile,strengths,skills}/sample-solutions-*.md` | Fixtures that make the solutions variant real in CI and preview tiers. |
| `packages/web-astro/src/pages/cv/print/[variant]/human.astro` | Print route, keyed by slug. Replaces `print/human.astro`. |
| `packages/web-astro/src/pages/cv/print/[variant]/bot.astro` | Print route, keyed by slug. Replaces `print/bot.astro`. |
| `packages/web-astro-e2e/src/e2e/cv-variants.spec.ts` | Landing renders available variants only; cards lead to variant pages; seeds hide when A.I.R. is off. |

**Modified files**

| Path | Change |
|---|---|
| `packages/web-astro/src/content.config.ts` | `variant`, `pitch`, `sectionOrder` on singleton sections; `variants` overrides on `experience`. |
| `packages/web-astro/src/util/resume/load.ts` | `loadResume(variant)`, `availableVariants()`, `variantCards()`, override application. |
| `packages/web-astro/src/pages/cv/index.astro` | Becomes the chooser landing. |
| `packages/web-astro/src/pages/cv/for-bots.astro` | Loads the default variant explicitly. |
| `packages/web-astro/src/util/air/suggested.mjs` | Every suggestion gains a `lane`; adds `LANES` and `seedsForLane`. |
| `packages/web-astro/src/util/air/retrieval.mjs` | `selectContext` accepts `options.role` and applies a tie-breaking boost. |
| `packages/web-astro/src/util/air/prompt.mjs` | `buildUserMessage` accepts an optional role line. |
| `packages/web-astro/src/pages/api/air/ask.ts` | Accepts and validates an optional `role` in the request body. |
| `packages/web-astro/src/react/AIResume.tsx` | `seed` and `role` props. |
| `packages/web-astro/src/react/AskAir.tsx` | `role` prop, passed through to the dialog. |
| `packages/web-astro/src/react/ResumeDownload.tsx` | `variant` prop, sent with the request. |
| `packages/web-astro/src/util/resume/fingerprint.mjs` | `FINGERPRINTED_FILES` gains `variants.mjs`, loses the two old print route paths, gains the two new ones. |
| `packages/web-astro/src/util/resume/resume.data.ts` | `REQUEST_PATH` moves to `/cv/product/#download`. |
| `packages/web-astro/src/components/resume/ResumeVisual.astro` | Honours `resume.sectionOrder`. |
| `packages/web-astro/src/components/resume/ResumeFull.astro` | Honours `resume.sectionOrder`. |
| `packages/web-astro/src/pages/api/resume/request.ts` | Issues tokens carrying a `variant` claim. |
| `packages/web-astro/src/pages/api/resume/download.ts` | Serves by `variant:kind`, verifies the variant claim. |
| `scripts/resume-pdf.mjs` | Iterates available variants across both kinds. |
| `packages/web-astro/src/util/resume/pdfs.spec.ts` | Asserts over the variant-keyed map. |
| `packages/web-astro-e2e/src/e2e/resume.spec.ts` | Existing resume assertions move to `/cv/product`. |
| `docs/CONTENT-MODEL.md`, `docs/RESUME.md`, `CLAUDE.md` | Document the variant fields, the four PDFs, and the new routes. |

---

## Task 1: Variant registry

The closed set of legal variant slugs, and the one place that decides how a slug becomes a route path and a PDF key. Everything downstream reads this, so no other file may hardcode a slug.

**Files:**
- Create: `packages/web-astro/src/util/resume/variants.mjs`
- Create: `packages/web-astro/src/util/resume/variants.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `VARIANTS: ReadonlyArray<{slug: string, path: string, filenameSuffix: string}>`
  - `DEFAULT_VARIANT: 'product'`
  - `PDF_KINDS: readonly ['human', 'bot']`
  - `isVariantSlug(slug: string): boolean`
  - `variantBySlug(slug: string): {slug, path, filenameSuffix} | undefined`
  - `pdfKey(variant: string, kind: string): string` returning `` `${variant}:${kind}` ``
  - `parsePdfKey(key: string): {variant: string, kind: string} | undefined`
  - `pdfFilename(variant: string, kind: string): string`

- [ ] **Step 1: Write the failing test**

Create `packages/web-astro/src/util/resume/variants.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';

import {
  VARIANTS,
  DEFAULT_VARIANT,
  PDF_KINDS,
  isVariantSlug,
  variantBySlug,
  pdfKey,
  parsePdfKey,
  pdfFilename,
} from './variants.mjs';

describe('variant registry', () => {
  it('gives every variant a unique slug and a unique path', () => {
    const slugs = VARIANTS.map((v) => v.slug);
    const paths = VARIANTS.map((v) => v.path);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('routes every variant under /cv/ with a trailing slash', () => {
    for (const variant of VARIANTS) {
      expect(variant.path, variant.slug).toBe(`/cv/${variant.slug}/`);
    }
  });

  it('includes the default variant', () => {
    expect(isVariantSlug(DEFAULT_VARIANT)).toBe(true);
  });

  it('rejects a slug that is not registered', () => {
    expect(isVariantSlug('air')).toBe(false);
    expect(isVariantSlug('for-bots')).toBe(false);
    expect(isVariantSlug('print')).toBe(false);
    expect(variantBySlug('nope')).toBeUndefined();
  });

  it('round-trips a pdf key', () => {
    for (const variant of VARIANTS) {
      for (const kind of PDF_KINDS) {
        expect(parsePdfKey(pdfKey(variant.slug, kind))).toEqual({
          variant: variant.slug,
          kind,
        });
      }
    }
  });

  it('rejects a malformed pdf key', () => {
    expect(parsePdfKey('human')).toBeUndefined();
    expect(parsePdfKey('product:sideways')).toBeUndefined();
    expect(parsePdfKey('nope:human')).toBeUndefined();
  });

  // Two downloads landing in the same Downloads folder must not overwrite
  // each other, which is the invariant pdfs.spec.ts asserts on the artifacts.
  it('names a distinct file for every variant and kind', () => {
    const names = VARIANTS.flatMap((v) =>
      PDF_KINDS.map((kind) => pdfFilename(v.slug, kind)),
    );
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[\w-]+\.pdf$/);
  });

  it('keeps the default variant on the established filenames', () => {
    expect(pdfFilename('product', 'human')).toBe('Eddie-Freeman-Resume.pdf');
    expect(pdfFilename('product', 'bot')).toBe('Eddie-Freeman-Resume-ATS.pdf');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/web-astro && npx vitest run src/util/resume/variants.spec.ts
```

Expected: FAIL — `Failed to resolve import "./variants.mjs"`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/web-astro/src/util/resume/variants.mjs`:

```javascript
/**
 * The CV variants, and the only place that decides what a variant slug means.
 *
 * A slug is the key for the whole feature: it names a route, selects which
 * singleton sections the loader picks, and identifies a generated PDF. Four
 * consumers read this list — the loader, the chooser landing, the print routes
 * and scripts/resume-pdf.mjs — and a second list would drift from the first.
 * Same discipline, for the same reason, as CORPUS_COLLECTIONS in util/air.
 *
 * Registering a variant here does not publish it. `availableVariants()` in
 * load.ts asks the content collection which slugs actually have a profile
 * entry, so a registered variant with no prose 404s rather than rendering an
 * empty page or leaving a dead card on the landing.
 *
 * ## Why the filename suffix lives here and not in content
 *
 * It is not prose and it never changes with a reframe, but it does have to be
 * stable across a regeneration: a download that changes filename between runs
 * leaves two copies in someone's Downloads folder. Content is resealed by hand;
 * this is not the kind of value that should need a key to correct.
 */

/**
 * @typedef {object} Variant
 * @property {string} slug
 * @property {string} path Route path, with a trailing slash.
 * @property {string} filenameSuffix Appended before the kind, so the default
 *   variant keeps the filenames already in circulation.
 */

/** @type {ReadonlyArray<Variant>} */
export const VARIANTS = Object.freeze([
  Object.freeze({ slug: 'product', path: '/cv/product/', filenameSuffix: '' }),
  Object.freeze({
    slug: 'solutions',
    path: '/cv/solutions/',
    filenameSuffix: '-Solutions',
  }),
  Object.freeze({
    slug: 'leadership',
    path: '/cv/leadership/',
    filenameSuffix: '-Leadership',
  }),
]);

/** The variant a bare request resolves to, and the fallback for any section a variant does not override. */
export const DEFAULT_VARIANT = 'product';

/** The two renderings each variant is printed to. */
export const PDF_KINDS = Object.freeze(['human', 'bot']);

/**
 * @param {string} slug
 * @returns {Variant | undefined}
 */
export function variantBySlug(slug) {
  return VARIANTS.find((variant) => variant.slug === slug);
}

/**
 * @param {string} slug
 * @returns {boolean}
 */
export function isVariantSlug(slug) {
  return Boolean(variantBySlug(slug));
}

/**
 * The key a generated PDF is stored under.
 *
 * A composed string rather than a nested map: the generated module is written
 * by a script and read by an endpoint, and a flat map keeps both sides a single
 * lookup with no intermediate that can be undefined.
 *
 * @param {string} variant
 * @param {string} kind
 * @returns {string}
 */
export function pdfKey(variant, kind) {
  return `${variant}:${kind}`;
}

/**
 * @param {string} key
 * @returns {{variant: string, kind: string} | undefined}
 */
export function parsePdfKey(key) {
  const [variant, kind, ...rest] = String(key).split(':');
  if (rest.length > 0) return undefined;
  if (!isVariantSlug(variant)) return undefined;
  if (!PDF_KINDS.includes(kind)) return undefined;
  return { variant, kind };
}

/**
 * @param {string} variant
 * @param {string} kind
 * @returns {string} e.g. `Eddie-Freeman-Resume-Solutions-ATS.pdf`
 */
export function pdfFilename(variant, kind) {
  const entry = variantBySlug(variant);
  if (!entry) throw new Error(`unknown resume variant: ${variant}`);
  const suffix = kind === 'bot' ? '-ATS' : '';
  return `Eddie-Freeman-Resume${entry.filenameSuffix}${suffix}.pdf`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/web-astro && npx vitest run src/util/resume/variants.spec.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Run the full check suite**

```bash
yarn ci
```

Expected: all four targets green.

- [ ] **Step 6: Commit**

```bash
git add packages/web-astro/src/util/resume/variants.mjs packages/web-astro/src/util/resume/variants.spec.ts
git commit -m "feat(cv): add the variant registry

One frozen list decides what a variant slug means: its route, its PDF
filenames, and the key its generated PDFs are stored under. Everything
downstream reads it, so no consumer hardcodes a slug."
```

---

## Task 2: Variant fields on the content schema, and solutions fixtures

Add the schema fields the model needs, and the fixtures that make a second variant exist in every build without the seal key. Nothing consumes the fields yet, so this task is inert at runtime and green on its own.

**Files:**
- Modify: `packages/web-astro/src/content.config.ts` (the `ResumeSchema` discriminated union, around lines 356-470)
- Create: `packages/web-astro/src/content/resume/profile/sample-solutions-profile.md`
- Create: `packages/web-astro/src/content/resume/strengths/sample-solutions-strengths.md`
- Create: `packages/web-astro/src/content/resume/skills/sample-solutions-skills.md`
- Modify: `packages/web-astro/src/content/resume/experience/sample-current-role.md`
- Modify: `packages/web-astro/src/content/resume/profile/sample-profile.md`

**Interfaces:**
- Consumes: nothing (Task 1's registry is not imported here — `content.config.ts` runs in Astro's config context and the schema states slugs as a plain `z.string()`, validated by the loader in Task 3).
- Produces: schema fields `variant`, `pitch`, `sectionOrder` on `profile`; `variant` on `strengths` and `skills`; `variants` on `experience`.

- [ ] **Step 1: Add the schema fields**

In `packages/web-astro/src/content.config.ts`, add this shared fragment immediately after the `resumeBase` declaration:

```typescript
/**
 * Which CV variant a singleton section belongs to.
 *
 * Absent means the default (`product`), so every file written before variants
 * existed stays valid and stays the fallback. The loader resolves
 * variant-first: a section with no variant-specific file falls back here rather
 * than disappearing, which is what lets a variant override only what it
 * genuinely reframes.
 *
 * A plain string rather than an enum of slugs: the authoritative list is
 * util/resume/variants.mjs, and importing it into the Astro config context to
 * build a Zod enum would put a build-order dependency between the two for a
 * check the loader already makes with a better error message.
 */
const variantField = {
  variant: z.string().optional(),
};
```

Then apply the changes below.

In the `profile` member, spread `...variantField` after `...resumeBase` and add:

```typescript
    /**
     * One line of chooser copy for this variant's card on /cv.
     *
     * Lives in content rather than in the landing page so a new variant appears
     * on the chooser the moment its prose is sealed, with no code change. Read
     * only by the landing.
     */
    pitch: z.string().optional(),
    /**
     * The order the visual page lays sections out in, when this variant wants a
     * different one.
     *
     * Ordering is part of a framing: a solutions reader should meet the talks
     * before the stack. Absent means the established order.
     */
    sectionOrder: z
      .array(
        z.enum([
          'strengths',
          'experience',
          'skills',
          'speaking',
          'education',
        ]),
      )
      .optional(),
```

In the `strengths` and `skills` members, spread `...variantField` after `...resumeBase`.

In the `experience` member, add after `featured`:

```typescript
    /**
     * Per-variant emphasis, keyed by variant slug.
     *
     * Facts stay single-source: a variant may re-spotlight bullets and swap the
     * condensed opener, and may do nothing else. A correction to a bullet lands
     * once and reaches every variant, which is the whole reason experience is
     * not duplicated per variant the way the singleton sections are.
     *
     * `featured` here replaces the base list rather than extending it, because a
     * reframe is a different selection and not an addition. The loader range
     * checks it against the same bullets.
     */
    variants: z
      .record(
        z.string(),
        z.object({
          featured: z.array(z.number().int().nonnegative()).optional(),
          summary: z.string().optional(),
          lede: z.string().optional(),
        }),
      )
      .optional(),
```

- [ ] **Step 2: Add `pitch` to the existing profile fixture**

The default variant needs a card too. In `packages/web-astro/src/content/resume/profile/sample-profile.md`, add to the frontmatter after `summary`:

```yaml
pitch: >-
  Sample pitch for the default variant, so the chooser has a card to lay out.
```

- [ ] **Step 3: Create the solutions fixtures**

`packages/web-astro/src/content/resume/profile/sample-solutions-profile.md`:

```markdown
---
section: profile
variant: solutions
title: 'Eddie Freeman — Solutions Engineer (sample)'
headline: 'Solutions Engineer · Developer Platforms · AI-Native (sample)'
location: 'Portland, OR'
order: 90
summary: >-
  Sample solutions summary. The real variant is sealed; this fixture exists so a
  build without the seal key still renders a second variant to assert against.
pitch: >-
  Sample solutions pitch, so the chooser lays out more than one card.
sectionOrder: ['strengths', 'experience', 'speaking', 'skills', 'education']
stats: [{ value: '15+', label: 'years building production systems' }, { value: '2', label: 'sample stat tiles' }]
tags: ['sample', 'fixture', 'solutions engineering', 'presales', 'partner']
---

Sample long-form solutions summary. Loaded only behind `PUBLIC_SHOW_FIXTURES`,
and only when no real resume content is present — see `loadResume`.
```

`packages/web-astro/src/content/resume/strengths/sample-solutions-strengths.md`:

```markdown
---
section: strengths
variant: solutions
title: 'Core strengths, solutions framing (sample)'
order: 90
items:
  - title: 'Sample solutions strength'
    detail: 'Placeholder detail, so the strengths grid has something to lay out.'
  - title: 'Second sample solutions strength'
    detail: 'A second card, because the grid is two columns.'
    wide: true
tags: ['sample', 'fixture', 'strengths', 'vendor management']
---

- **Sample solutions strength** — placeholder detail.
- **Second sample solutions strength** — a second card.
```

`packages/web-astro/src/content/resume/skills/sample-solutions-skills.md`:

```markdown
---
section: skills
variant: solutions
title: 'Skills, solutions framing (sample)'
order: 90
groups:
  - group: 'Customer-facing (sample)'
    tone: accent
    items: ['Discovery', 'Proof of concept', 'Enablement']
  - group: 'Sample group'
    tone: neutral
    items: ['TypeScript', 'Astro', 'Cloudflare Workers']
tags: ['sample', 'fixture', 'skills', 'solutions engineering']
---

**Customer-facing (sample)** — discovery, proof of concept, enablement.
```

- [ ] **Step 4: Add a variant override to the experience fixture**

In `packages/web-astro/src/content/resume/experience/sample-current-role.md`, add to the frontmatter:

```yaml
variants:
  solutions:
    featured: [1]
    summary: >-
      Sample solutions-framed summary for this role, so the override path has
      something to exercise.
```

Check the file's body first: `featured: [1]` requires at least two bullets. If the fixture has fewer, use `featured: [0]` instead — the loader range checks this and the build will fail loudly if it is wrong.

- [ ] **Step 5: Verify the schema accepts everything**

```bash
yarn ci
```

Expected: green. `astro check` parses every content file against the schema, so a bad field or an out-of-range `featured` index fails here.

- [ ] **Step 6: Commit**

```bash
git add packages/web-astro/src/content.config.ts packages/web-astro/src/content/resume
git commit -m "feat(cv): add variant fields to the resume schema

Singleton sections may declare a variant; experience carries per-variant
emphasis only, so facts stay single-source and a correction lands once.
Solutions fixtures make a second variant real in every keyless build."
```

---

## Task 3: Loader variant resolution

Teach `loadResume` to assemble a named variant, and give the landing page the data it needs to draw cards. This is the heart of the content model, so it gets real unit tests.

**Files:**
- Modify: `packages/web-astro/src/util/resume/load.ts`
- Create: `packages/web-astro/src/util/resume/load.spec.ts`

**Interfaces:**
- Consumes: `DEFAULT_VARIANT`, `VARIANTS`, `isVariantSlug` from `./variants.mjs`.
- Produces:
  - `loadResume(variant?: string): Promise<Resume | null>`
  - `availableVariants(): Promise<string[]>`
  - `variantCards(): Promise<VariantCard[]>`
  - `assembleVariant(entries, variant)` — exported for tests only
  - `Resume` gains `variant: string`, `pitch?: string`, `sectionOrder?: SectionName[]`
  - `type SectionName = 'strengths' | 'experience' | 'skills' | 'speaking' | 'education'`
  - `interface VariantCard { slug: string; path: string; headline: string; pitch: string; }`

- [ ] **Step 1: Write the failing test**

Create `packages/web-astro/src/util/resume/load.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';

import { assembleVariant } from './load';

/**
 * The loader's variant resolution, tested against hand-built entries rather
 * than the content collection: `getCollection` needs an Astro runtime, and the
 * rules worth asserting here are about which entry wins, not about globbing.
 */

type Entry = { id: string; data: Record<string, unknown>; body?: string };

const profile = (variant?: string): Entry => ({
  id: `profile/${variant ?? 'default'}`,
  data: {
    section: 'profile',
    variant,
    title: `Eddie Freeman — ${variant ?? 'default'}`,
    headline: `${variant ?? 'default'} headline`,
    pitch: `${variant ?? 'default'} pitch`,
    location: 'Portland, OR',
    summary: `${variant ?? 'default'} summary`,
    stats: [],
    tags: [],
    order: 50,
    ...(variant === 'solutions'
      ? { sectionOrder: ['strengths', 'experience', 'speaking', 'skills', 'education'] }
      : {}),
  },
  body: 'long summary',
});

const strengths = (variant?: string): Entry => ({
  id: `strengths/${variant ?? 'default'}`,
  data: {
    section: 'strengths',
    variant,
    title: 'strengths',
    order: 50,
    tags: [],
    items: [{ title: `${variant ?? 'default'} strength`, detail: 'detail', wide: false }],
  },
});

const skills = (variant?: string): Entry => ({
  id: `skills/${variant ?? 'default'}`,
  data: {
    section: 'skills',
    variant,
    title: 'skills',
    order: 50,
    tags: [],
    groups: [{ group: `${variant ?? 'default'} group`, tone: 'accent', items: ['TypeScript'] }],
  },
});

const speaking: Entry = {
  id: 'speaking/speaking',
  data: {
    section: 'speaking',
    title: 'speaking',
    order: 50,
    tags: [],
    evaluation: 'evaluation',
    talks: [],
  },
};

const education: Entry = {
  id: 'education/education',
  data: {
    section: 'education',
    title: 'education',
    order: 50,
    tags: [],
    entries: [{ period: '2004', institution: 'Somewhere', detail: 'detail' }],
  },
};

const role: Entry = {
  id: 'experience/current',
  data: {
    section: 'experience',
    title: 'current',
    order: 10,
    tags: [],
    org: 'Wandering Hearth',
    role: 'Founder',
    location: 'Portland, OR',
    dates: 'Feb 2023 – Present',
    start: '2023-02',
    tier: 'selected',
    chips: [],
    highlights: [],
    lede: 'base lede',
    summary: 'base summary',
    featured: [0],
    variants: {
      solutions: { featured: [1], summary: 'solutions summary' },
    },
  },
  body: '- first bullet\n- second bullet\n',
};

const base = [profile(), strengths(), skills(), speaking, education, role];

describe('assembleVariant', () => {
  it('uses the default sections when no variant is asked for', () => {
    const resume = assembleVariant(base, 'product');
    expect(resume.variant).toBe('product');
    expect(resume.headline).toBe('default headline');
    expect(resume.strengths[0].title).toBe('default strength');
  });

  it('prefers a variant-specific singleton over the default', () => {
    const entries = [...base, profile('solutions'), strengths('solutions')];
    const resume = assembleVariant(entries, 'solutions');
    expect(resume.headline).toBe('solutions headline');
    expect(resume.strengths[0].title).toBe('solutions strength');
  });

  it('falls back to the default for a section the variant does not override', () => {
    const entries = [...base, profile('solutions')];
    const resume = assembleVariant(entries, 'solutions');
    // No solutions skills file exists, so the default one stands.
    expect(resume.skills[0].group).toBe('default group');
  });

  it('carries the variant section order through', () => {
    const entries = [...base, profile('solutions')];
    expect(assembleVariant(entries, 'solutions').sectionOrder).toEqual([
      'strengths',
      'experience',
      'speaking',
      'skills',
      'education',
    ]);
    expect(assembleVariant(base, 'product').sectionOrder).toBeUndefined();
  });

  it('applies a role emphasis override without changing the bullets', () => {
    const entries = [...base, profile('solutions')];
    const resume = assembleVariant(entries, 'solutions');
    const current = resume.now;
    expect(current.summary).toBe('solutions summary');
    // The lede was not overridden, so the base one stands.
    expect(current.lede).toBe('base lede');
    // Same facts, different spotlight.
    expect(current.bullets.map((b) => b.text)).toEqual([
      'first bullet',
      'second bullet',
    ]);
    expect(current.bullets[0].featured).toBeUndefined();
    expect(current.bullets[1].featured).toBe(true);
  });

  it('leaves the default variant untouched by another variant override', () => {
    const resume = assembleVariant(base, 'product');
    expect(resume.now.summary).toBe('base summary');
    expect(resume.now.bullets[0].featured).toBe(true);
  });

  // An index past the end silently drops emphasis, which is exactly the drift
  // indices are vulnerable to when bullets are edited under a variant.
  it('rejects an override that spotlights a bullet that does not exist', () => {
    const broken: Entry = {
      ...role,
      data: {
        ...role.data,
        variants: { solutions: { featured: [7] } },
      },
    };
    const entries = [profile(), strengths(), skills(), speaking, education, broken];
    expect(() => assembleVariant(entries, 'solutions')).toThrow(/featured index 7/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/web-astro && npx vitest run src/util/resume/load.spec.ts
```

Expected: FAIL — `assembleVariant` is not exported from `./load`.

- [ ] **Step 3: Implement the loader changes**

In `packages/web-astro/src/util/resume/load.ts`:

Add to the imports at the top:

```typescript
import {
  DEFAULT_VARIANT,
  VARIANTS,
  isVariantSlug,
} from './variants.mjs';
```

Add above the `Resume` interface:

```typescript
/** The sections the visual page can reorder. Mirrors `profile.sectionOrder`. */
export type SectionName =
  | 'strengths'
  | 'experience'
  | 'skills'
  | 'speaking'
  | 'education';

/** One chooser card on /cv. */
export interface VariantCard {
  slug: string;
  path: string;
  headline: string;
  pitch: string;
}
```

Add these three fields to the `Resume` interface:

```typescript
  /** Which variant this assembly is. Always a registered slug. */
  variant: string;
  /** One line of chooser copy, when the variant supplies one. */
  pitch?: string;
  /** The section order this variant asks for, when it asks for one. */
  sectionOrder?: SectionName[];
```

Replace the existing `loadResume` with the following. The private `assemble` function is renamed to `assembleVariant` and exported in the step after this one, so there is no delegating wrapper left behind:

```typescript
/**
 * Every entry that is real, or every fixture, but never a mix.
 *
 * Split out of `loadResume` because three callers need the same selection —
 * loading a variant, listing which variants exist, and building the chooser
 * cards — and repeating the rule is how the fixtures rule drifted last time.
 */
async function selectEntries(): Promise<
  Awaited<ReturnType<typeof getCollection<'resume'>>>
> {
  const all = await getCollection('resume');
  if (all.length === 0) return [];

  /*
   * Fixtures fill in only when there is nothing real — the rule
   * `scripts/air-eval.mjs` already uses on its corpus. Without it, a build with
   * both (seal key present *and* PUBLIC_SHOW_FIXTURES on) could pick the sample
   * profile over the real one, because the singleton sections take the first
   * match. A sample headline mixed into a real resume is worse than either alone,
   * and invisible until someone reads the page.
   *
   * The flag is checked *here* rather than left to `CONTENT_GLOB`, which cannot do
   * it for this collection: its negation pattern for `sample-` files excludes a
   * fixture at a collection's root — star's does not reach the bundle — but not
   * one a directory deep, and the resume uses a directory per section. Measured,
   * not assumed. So the filename convention is not load-bearing here; this check
   * is.
   */
  const real = all.filter((entry) => !entry.id.includes('sample-'));
  if (real.length > 0) return real;

  return showFixtures(import.meta.env) ? all : [];
}

/**
 * @param variant A registered variant slug. Unknown slugs return null rather
 *   than falling back, so a typo in a link is a 404 and not a silent redirect
 *   to a different person's framing of the same career.
 * @returns The assembled resume, or null when the collection is empty — which
 *   means the seal key is absent, not that the resume is blank.
 */
export async function loadResume(
  variant: string = DEFAULT_VARIANT,
): Promise<Resume | null> {
  if (!isVariantSlug(variant)) return null;

  const entries = await selectEntries();
  if (entries.length === 0) return null;

  // A registered variant with no profile of its own is not published. Only the
  // default falls back, because the default *is* the fallback.
  if (variant !== DEFAULT_VARIANT && !hasVariantProfile(entries, variant)) {
    return null;
  }

  return assembleVariant(entries, variant);
}

/** Does this variant have prose of its own? */
function hasVariantProfile(
  entries: Awaited<ReturnType<typeof getCollection<'resume'>>>,
  variant: string,
): boolean {
  return entries.some(
    (entry) =>
      entry.data.section === 'profile' &&
      (entry.data as { variant?: string }).variant === variant,
  );
}

/**
 * Which variants are actually publishable right now.
 *
 * Registry order, so the chooser lays cards out in a deliberate order rather
 * than in whatever order the content glob happened to return. The default is
 * always included when there is any content at all; the others have to earn it
 * with a profile entry. This is what keeps an unwritten variant off the landing
 * instead of leaving a card that leads to a 404.
 */
export async function availableVariants(): Promise<string[]> {
  const entries = await selectEntries();
  if (entries.length === 0) return [];

  return VARIANTS.filter(
    (variant) =>
      variant.slug === DEFAULT_VARIANT ||
      hasVariantProfile(entries, variant.slug),
  ).map((variant) => variant.slug);
}

/**
 * The chooser cards, in registry order.
 *
 * Card copy comes from each variant's sealed profile rather than from the
 * landing page, so a new variant appears the moment its prose is sealed and no
 * code change is needed to introduce it.
 */
export async function variantCards(): Promise<VariantCard[]> {
  const slugs = await availableVariants();
  const cards: VariantCard[] = [];

  for (const slug of slugs) {
    const resume = await loadResume(slug);
    if (!resume) continue;
    const entry = VARIANTS.find((variant) => variant.slug === slug);
    if (!entry) continue;
    cards.push({
      slug,
      path: entry.path,
      headline: resume.headline,
      // A card with no pitch still renders; the headline carries it.
      pitch: resume.pitch ?? '',
    });
  }

  return cards;
}
```

Now rename `assemble` to `assembleVariant`, export it, and give it a `variant` parameter. Replace its signature and the section-selection block:

```typescript
/**
 * @param entries Either the real resume or the fixtures, never a mix.
 * @param variant Which framing to assemble. Singleton sections resolve
 *   variant-first and fall back to the default; experience is single-source
 *   with per-variant emphasis applied on top.
 */
export function assembleVariant(
  entries: Awaited<ReturnType<typeof getCollection<'resume'>>>,
  variant: string = DEFAULT_VARIANT,
): Resume {
  const bySection = <T extends string>(section: T) =>
    entries
      .filter((entry) => entry.data.section === section)
      .sort((a, b) => a.data.order - b.data.order);

  /**
   * The variant's own file if it has one, otherwise the default's.
   *
   * Fallback rather than failure, so a variant overrides only what it genuinely
   * reframes. Version C rewrites the profile, the strengths and the skills and
   * leaves speaking and education alone; duplicating the two it did not touch
   * would put the same facts in two files and let them drift.
   */
  const singleton = <T extends string>(section: T) => {
    const candidates = bySection(section);
    const specific = candidates.find(
      (entry) => (entry.data as { variant?: string }).variant === variant,
    );
    return (
      specific ??
      candidates.find(
        (entry) => !(entry.data as { variant?: string }).variant,
      )
    );
  };

  const profile = singleton('profile');
  const strengths = singleton('strengths');
  const skills = singleton('skills');
  const speaking = singleton('speaking');
  const education = singleton('education');
  const roleEntries = bySection('experience');
```

The `missing` check below it is unchanged. In the `roles` map, apply the override. Replace the body of the `roleEntries.map` callback's opening with:

```typescript
  const roles: ResumeRole[] = roleEntries.map((entry) => {
    const data = entry.data as Extract<
      typeof entry.data,
      { section: 'experience' }
    >;
    const bullets = parseBullets(entry.body ?? '');

    /*
     * Emphasis only. A variant may re-spotlight bullets and swap the condensed
     * opener; it may not change a fact, because the facts are the thing that
     * must stay single-source. `featured` replaces rather than extends: a
     * reframe is a different selection, not an addition.
     */
    const override =
      (data as { variants?: Record<string, {
        featured?: number[];
        summary?: string;
        lede?: string;
      }> }).variants?.[variant] ?? {};

    const featured = override.featured ?? data.featured;
    const lede = override.lede ?? data.lede;
    const summary = override.summary ?? data.summary;

    // An index past the end would silently drop emphasis on the visual page,
    // which is exactly the drift indices are vulnerable to when bullets are
    // edited. Fail the build instead.
    for (const index of featured) {
      if (index >= bullets.length) {
        throw new Error(
          `${entry.id}: featured index ${index} is past the last bullet (${bullets.length})`,
        );
      }
    }

    return {
      org: data.org,
      role: data.role,
      location: data.location,
      dates: data.dates,
      start: data.start,
      ...(data.end ? { end: data.end } : {}),
      ...(data.period ? { period: data.period } : {}),
      ...(lede ? { lede } : {}),
      ...(summary ? { summary } : {}),
      ...(data.compact ? { compact: data.compact } : {}),
      ...(data.chips.length ? { tags: [...data.chips] } : {}),
      ...(data.highlights.length ? { highlights: [...data.highlights] } : {}),
      tier: data.tier,
      bullets: bullets.map((text, index) => ({
        text,
        ...(featured.includes(index) ? { featured: true } : {}),
      })),
    };
  });
```

Finally, in the returned object, add the three new fields alongside the existing ones:

```typescript
  return {
    variant,
    name: profileData.title.split('—')[0].trim(),
    headline: profileData.headline,
    ...(profileData.pitch ? { pitch: profileData.pitch } : {}),
    ...(profileData.sectionOrder
      ? { sectionOrder: [...profileData.sectionOrder] }
      : {}),
    location: profileData.location,
    // ...the rest is unchanged
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/web-astro && npx vitest run src/util/resume/load.spec.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Run the full check suite**

```bash
yarn ci
```

Expected: green. `/cv` still renders the default variant, because `loadResume()` with no argument is unchanged in behaviour.

- [ ] **Step 6: Commit**

```bash
git add packages/web-astro/src/util/resume/load.ts packages/web-astro/src/util/resume/load.spec.ts
git commit -m "feat(cv): resolve the resume by variant

Singleton sections resolve variant-first and fall back to the default, so a
variant overrides only what it reframes. Experience stays single-source with
per-variant emphasis applied on top, range checked the same way as the base."
```

---

## Task 4: Variant pages at /cv/[variant]

One dynamic route renders any available variant. `/cv` keeps rendering the default resume for now; the chooser replaces it in Task 5.

**Files:**
- Create: `packages/web-astro/src/pages/cv/[variant].astro`
- Modify: `packages/web-astro/src/pages/cv/for-bots.astro`

**Interfaces:**
- Consumes: `loadResume(variant)` from `@util/resume/load`; `isVariantSlug` from `@util/resume/variants.mjs`; `resolveSections` from `@util/flags/sections.mjs`.
- Produces: routes `/cv/product/`, `/cv/solutions/`, and a 404 for every unregistered or unwritten slug.

- [ ] **Step 1: Create the route**

Copy `packages/web-astro/src/pages/cv/index.astro` to `packages/web-astro/src/pages/cv/[variant].astro`, then change its frontmatter to read the slug from params. The full frontmatter:

```astro
---
import Layout from '@layouts/Layout.astro';
import ResumeVisual from '@components/resume/ResumeVisual.astro';
import { ResumeDownload } from '../../react/ResumeDownload';
import { AskAir } from '../../react/AskAir';
import { loadResume } from '@util/resume/load';
import { isVariantSlug } from '@util/resume/variants.mjs';
import { resolveSections } from '@util/flags/sections.mjs';
import '../../styles/resume-organic.css';

/**
 * One CV, in one framing.
 *
 * ## Why a dynamic route and not a file per variant
 *
 * The variants differ in prose, never in structure — that is the whole premise
 * of the content model. A file per variant would be the same page copied N
 * times, and adding the Engineering Leader framing would mean a code change to
 * publish prose. Here it is a content drop: seal three singleton files and the
 * route starts answering.
 *
 * Astro resolves static segments before dynamic ones, so `/cv/air`,
 * `/cv/for-bots` and `/cv/print/...` keep their own pages and never reach this
 * one. `cv-variants.spec.ts` asserts that, because it is a routing behaviour we
 * depend on rather than one we control.
 */
export const prerender = false;

// Gate the route, not just the nav link — an unlisted page is still a public
// page if it responds.
const sections = await resolveSections(import.meta.env);
if (!sections.resume) {
  return new Response(null, { status: 404, statusText: 'Not found' });
}

const variant = Astro.params.variant ?? '';
if (!isVariantSlug(variant)) {
  return new Response(null, { status: 404, statusText: 'Not found' });
}

/*
 * Null means one of two things, and both are a 404: the seal key is absent so
 * the collection is empty, or this variant is registered but nobody has written
 * it yet. Neither is a page worth serving — an empty header with seven blank
 * sections is worse than nothing.
 */
const resume = await loadResume(variant);
if (!resume) {
  return new Response(null, { status: 404, statusText: 'Not found' });
}

const botsPath = '/cv/for-bots';
const airPath = sections.air ? '/cv/air/' : undefined;
const pageTitle = `${resume.name} — ${resume.headline}`;
---
```

Keep the template body identical to `index.astro`'s, with two changes:

1. Pass the variant to the A.I.R. trigger so a question asked from this page carries the framing the visitor is reading:

```astro
{airPath && <AskAir client:visible href={airPath} role={resume.variant} />}
```

(The `role` prop lands in Task 7. Add it now; TypeScript will flag it until then, so **omit it in this task** and add it in Task 7 Step 6. The step there names this file.)

2. Leave `<ResumeDownload client:visible />` exactly as it is. The `variant` prop lands in Task 8.

3. Mark the machine-readable record as the alternate representation of this page, so a crawler reading any variant is pointed at the one canonical record rather than treating three framings as three careers. In the `<head>` slot the layout exposes, or inline if it does not:

```astro
<link rel="alternate" type="text/html" href={botsPath} title="Complete resume, machine readable" />
```

- [ ] **Step 2: Point for-bots at the default variant explicitly**

In `packages/web-astro/src/pages/cv/for-bots.astro`, change the load call and add the comment:

```astro
/*
 * Deliberately the default variant, not a per-variant machine record. A
 * generative engine reading three framings of one career has to decide which is
 * true, and the honest answer is that they all are. One canonical record, one
 * JSON-LD graph, no ambiguity.
 */
const resume = await loadResume(DEFAULT_VARIANT);
```

Add the import:

```astro
import { DEFAULT_VARIANT } from '@util/resume/variants.mjs';
```

- [ ] **Step 3: Verify the routes answer**

```bash
yarn ci
```

Then check by hand, since routing precedence is the risk this task carries:

```bash
cd packages/web-astro && PUBLIC_SHOW_RESUME=true PUBLIC_SHOW_AIR=true PUBLIC_SHOW_FIXTURES=true npx astro dev --port 4322
```

Expected, in another shell:

```bash
for path in /cv/product/ /cv/solutions/ /cv/air/ /cv/for-bots /cv/leadership/ /cv/nonsense/; do
  printf '%s -> ' "$path"
  curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:4322$path"
done
```

- `/cv/product/` → 200
- `/cv/solutions/` → 200
- `/cv/air/` → 200 (static beats dynamic; this is the assertion that matters)
- `/cv/for-bots` → 200
- `/cv/leadership/` → 404 (registered, no content)
- `/cv/nonsense/` → 404 (not registered)

Stop the dev server when done. Note that `astro dev` is a singleton daemon: if port 4322 is already serving something else, kill it rather than starting a second one.

- [ ] **Step 4: Commit**

```bash
git add packages/web-astro/src/pages/cv/\[variant\].astro packages/web-astro/src/pages/cv/for-bots.astro
git commit -m "feat(cv): serve each CV variant from one dynamic route

A registered slug with content renders; a registered slug without content and
an unregistered slug both 404. for-bots stays a single canonical record, so a
generative engine never has to pick between three framings of one career."
```

---

## Task 5: The chooser landing

Replace `/cv` with a chooser. Four bands: masthead, role cards, a slot for seed questions (filled in Task 7), and the honesty footer.

**Files:**
- Modify: `packages/web-astro/src/pages/cv/index.astro` (replace entirely)
- Create: `packages/web-astro/src/components/cv/RoleCard.astro`
- Create: `packages/web-astro-e2e/src/e2e/cv-variants.spec.ts`
- Modify: `packages/web-astro-e2e/src/e2e/resume.spec.ts`

**Interfaces:**
- Consumes: `variantCards()` from `@util/resume/load`.
- Produces: the `/cv` landing; `RoleCard` props `{ href: string; headline: string; pitch: string }`.

- [ ] **Step 1: Create the card component**

`packages/web-astro/src/components/cv/RoleCard.astro`:

```astro
---
/**
 * One role card on the CV chooser.
 *
 * Presentation only: every word comes from the variant's sealed profile, so
 * this file never needs editing to add a variant. The whole card is the link
 * rather than a link inside it — a card that looks clickable and is not is a
 * small betrayal, and a nested interactive element would make the target
 * ambiguous to a screen reader.
 */
interface Props {
  href: string;
  headline: string;
  pitch: string;
}

const { href, headline, pitch } = Astro.props;
---

<a
  href={href}
  class="organic group flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-6 no-underline transition-colors hover:border-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-underline dark:border-hairline-dark dark:bg-surface-dark dark:hover:border-link dark:focus-visible:outline-link"
>
  <h3 class="font-header text-xl leading-tight">{headline}</h3>
  {pitch && <p class="font-body leading-relaxed opacity-80">{pitch}</p>}
  <span class="mt-auto font-body text-sm opacity-70 group-hover:opacity-100">
    Read this version
    <span aria-hidden="true">&rarr;</span>
  </span>
</a>
```

- [ ] **Step 2: Replace the landing page**

Replace `packages/web-astro/src/pages/cv/index.astro` entirely:

```astro
---
import Layout from '@layouts/Layout.astro';
import RoleCard from '@components/cv/RoleCard.astro';
import { variantCards } from '@util/resume/load';
import { resolveSections } from '@util/flags/sections.mjs';
import '../../styles/resume-organic.css';

/**
 * The CV chooser.
 *
 * ## Why this is a page and not a menu
 *
 * The same career reads differently depending on what someone is hiring for,
 * and the visitor knows which they are and we do not. Asking is cheaper than
 * guessing, and cheaper than one CV that hedges. The cards are content, not
 * navigation: every word on them comes from the variant's own sealed profile,
 * which is what lets a new framing arrive as a content drop.
 *
 * The former `/cv` resume now lives at `/cv/product`. The site had been live
 * about a week when this changed, so there was no accumulated equity to
 * protect and a pure chooser reads cleaner than a chooser bolted above a full
 * document.
 */
export const prerender = false;

const sections = await resolveSections(import.meta.env);
if (!sections.resume) {
  return new Response(null, { status: 404, statusText: 'Not found' });
}

/*
 * No cards means no content, which means the seal key is absent. 404 rather
 * than publish a chooser with nothing to choose between.
 */
const cards = await variantCards();
if (cards.length === 0) {
  return new Response(null, { status: 404, statusText: 'Not found' });
}

const pageTitle = 'Eddie Freeman — CV';
---

<Layout {pageTitle}>
  <main class="organic mx-auto max-w-3xl px-4 py-10">
    <section class="mb-10">
      <h1 class="mb-4 font-header text-3xl leading-tight sm:text-4xl">
        What are you hiring for?
      </h1>
      <p class="font-body text-lg leading-relaxed">
        The work is the same either way. What changes is which parts of it
        matter to you, so pick the version that fits the problem you are trying
        to solve and read that one.
      </p>
    </section>

    <section aria-labelledby="cv-versions" class="mb-12">
      <h2 id="cv-versions" class="sr-only">Versions of the CV</h2>
      <div class="grid gap-4 sm:grid-cols-2">
        {
          cards.map((card) => (
            <RoleCard href={card.path} headline={card.headline} pitch={card.pitch} />
          ))
        }
      </div>
    </section>

    {/* Task 7 mounts the seed questions here. */}

    <footer class="border-t border-hairline pt-6 font-body text-sm leading-relaxed opacity-75 dark:border-hairline-dark">
      <p>
        Answers are drawn from a fixed record. Nothing is invented.
      </p>
    </footer>
  </main>
</Layout>
```

Copy on this page is public writing: no em-dashes, plain sentences, evergreen. Read `docs/VOICE.md` before changing a word of it.

- [ ] **Step 3: Move the existing resume e2e assertions**

In `packages/web-astro-e2e/src/e2e/resume.spec.ts`, replace every navigation to `/cv/` or `/cv` that expects the full resume with `/cv/product/`. Leave assertions about `/cv/air/`, `/cv/for-bots` and the download flow pointing where they already point.

- [ ] **Step 4: Write the failing e2e test**

Create `packages/web-astro-e2e/src/e2e/cv-variants.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

/**
 * The chooser and the variant routes.
 *
 * Runs against the built Worker with fixtures on, which is the only reason
 * these assertions are possible at all: the real resume is sealed and absent
 * from the repo, so `sample-solutions-*` is what makes a second variant exist
 * in CI. See playwright.config.ts for the flags the build is given.
 */

test.describe('CV chooser', () => {
  test('offers a card for every available variant', async ({ page }) => {
    await page.goto('/cv/');
    const cards = page.locator('main a[href^="/cv/"]');
    await expect(cards).toHaveCount(2);
  });

  test('has no card for a variant with no content', async ({ page }) => {
    await page.goto('/cv/');
    await expect(page.locator('a[href="/cv/leadership/"]')).toHaveCount(0);
  });

  test('every card leads somewhere that answers', async ({ page }) => {
    await page.goto('/cv/');
    const hrefs = await page.locator('main a[href^="/cv/"]').evaluateAll(
      (nodes) => nodes.map((node) => (node as HTMLAnchorElement).getAttribute('href')),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const response = await page.request.get(href!);
      expect(response.status(), href!).toBe(200);
    }
  });

  test('a card leads to that variant, not the default', async ({ page }) => {
    await page.goto('/cv/');
    await page.locator('a[href="/cv/solutions/"]').click();
    await expect(page).toHaveURL(/\/cv\/solutions\/?$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/solutions/i);
  });

  test('an unwritten variant 404s', async ({ page }) => {
    const response = await page.request.get('/cv/leadership/');
    expect(response.status()).toBe(404);
  });

  test('an unregistered slug 404s', async ({ page }) => {
    const response = await page.request.get('/cv/nonsense/');
    expect(response.status()).toBe(404);
  });

  // Static segments must keep beating the dynamic one, or /cv/air becomes a
  // 404 the moment this route exists.
  test('the sibling CV routes still answer', async ({ page }) => {
    for (const path of ['/cv/air/', '/cv/for-bots']) {
      const response = await page.request.get(path);
      expect(response.status(), path).toBe(200);
    }
  });
});
```

- [ ] **Step 5: Run the e2e suite**

```bash
nx e2e web-astro-e2e
```

Expected: PASS. If a wall of `ERR_CONNECTION_REFUSED` appears, that is a known wrangler flake — see `docs/RUNBOOK.md#known-failure-modes` before debugging the change. Note that the local runner reuses any server already on :4321, which may be another branch's; when local and CI disagree, believe CI.

- [ ] **Step 6: Run the full check suite**

```bash
yarn ci
```

- [ ] **Step 7: Commit**

```bash
git add packages/web-astro/src/pages/cv/index.astro packages/web-astro/src/components/cv/RoleCard.astro packages/web-astro-e2e/src/e2e/cv-variants.spec.ts packages/web-astro-e2e/src/e2e/resume.spec.ts
git commit -m "feat(cv): turn /cv into a role chooser

Card copy comes from each variant's sealed profile, so a new framing appears
on the chooser the moment its prose is sealed. A registered variant with no
content leaves no card and no dead link."
```

---

## Task 6: Lane-tagged suggestions

Give every A.I.R. suggestion a lane matching a variant slug, and add the pools the landing rotates through. No consumer changes yet, so this task is green on its own.

**Files:**
- Modify: `packages/web-astro/src/util/air/suggested.mjs`
- Create: `packages/web-astro/src/util/air/suggested.spec.ts`

**Interfaces:**
- Consumes: `VARIANTS`, `DEFAULT_VARIANT` from `../resume/variants.mjs`.
- Produces:
  - `SUGGESTED: Suggestion[]` where `Suggestion = {audience: string, question: string, lane: string}`
  - `LANES: readonly string[]` — every distinct lane, in registry order with `general` last
  - `seedsForLane(lane: string): Suggestion[]`
  - `suggestionSentence(limit?: number): string` — unchanged signature and behaviour

- [ ] **Step 1: Write the failing test**

Create `packages/web-astro/src/util/air/suggested.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest';

import { SUGGESTED, LANES, seedsForLane, suggestionSentence } from './suggested.mjs';
import { isVariantSlug } from '../resume/variants.mjs';

describe('suggested questions', () => {
  it('tags every suggestion with a lane', () => {
    for (const item of SUGGESTED) {
      expect(item.lane, item.question).toBeTruthy();
      expect(LANES, item.question).toContain(item.lane);
    }
  });

  // A lane is either a variant slug (so it can boost retrieval) or the explicit
  // catch-all. A third kind would be a lane nothing downstream knows about.
  it('uses variant slugs or the catch-all as lanes', () => {
    for (const lane of LANES) {
      expect(lane === 'general' || isVariantSlug(lane), lane).toBe(true);
    }
  });

  it('gives every lane at least three questions to rotate through', () => {
    for (const lane of LANES) {
      expect(seedsForLane(lane).length, lane).toBeGreaterThanOrEqual(3);
    }
  });

  it('returns nothing for a lane that does not exist', () => {
    expect(seedsForLane('nope')).toEqual([]);
  });

  it('writes every question as a question', () => {
    for (const item of SUGGESTED) {
      expect(item.question, item.question).toMatch(/\?$/);
    }
  });

  it('still quotes suggestions for the decline message', () => {
    expect(suggestionSentence(2)).toMatch(/^“.+” or “.+”$/);
    expect(suggestionSentence(1)).toMatch(/^“.+”$/);
    expect(suggestionSentence(0)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/web-astro && npx vitest run src/util/air/suggested.spec.ts
```

Expected: FAIL — `LANES` and `seedsForLane` are not exported.

- [ ] **Step 3: Rewrite the module**

Replace `packages/web-astro/src/util/air/suggested.mjs`:

```javascript
/**
 * The questions A.I.R. offers a visitor — rendered as buttons, rotated on the
 * CV chooser, and named in the decline message, so all three read from here.
 *
 * Every entry is a promise the page makes, so offline.spec.ts asserts each one
 * retrieves context. A question nothing answers fails the build.
 *
 * ## Why a lane and not just an audience
 *
 * `audience` says who is asking. `lane` says what they are hiring for, and it
 * is a variant slug on purpose: a visitor who picks a solutions question has
 * told us something the retrieval can use, and reusing the slug means there is
 * no second vocabulary to keep aligned with the first. `general` is the
 * explicit catch-all for questions that belong to no particular role, which is
 * better than leaving the field absent and making every consumer handle
 * undefined.
 *
 * A lane is a hint, never a filter. See selectContext in retrieval.mjs.
 */

import { VARIANTS } from '../resume/variants.mjs';

/**
 * @typedef {object} Suggestion
 * @property {string} audience  Who the question is written for.
 * @property {string} question
 * @property {string} lane      A variant slug, or 'general'.
 */

/** The catch-all lane, for questions that belong to no particular role. */
export const GENERAL_LANE = 'general';

/** @type {Suggestion[]} */
export const SUGGESTED = [
  // Product and AI-native. The default lane, and the first three are the ones
  // the decline message quotes, so they stay the broadest.
  {
    audience: 'Hiring manager',
    question: 'How does Eddie approach a system nobody wants to own?',
    lane: 'product',
  },
  {
    audience: 'Client',
    question: 'How quickly can Eddie prove out an MVP?',
    lane: 'product',
  },
  {
    audience: 'Hiring manager',
    question: 'What has Eddie actually shipped with agents in production?',
    lane: 'product',
  },

  // Solutions engineering.
  {
    audience: 'Partner',
    question: 'How does Eddie work with a team that is not his own?',
    lane: 'solutions',
  },
  {
    audience: 'Sales engineer',
    question: 'Has Eddie run a technical evaluation with a vendor?',
    lane: 'solutions',
  },
  {
    audience: 'Hiring manager',
    question: 'How does Eddie explain a platform to a non-technical buyer?',
    lane: 'solutions',
  },

  // Engineering leadership. The variant has no prose yet; the questions are
  // answerable from the existing corpus regardless, which is the bar every
  // seed has to clear.
  {
    audience: 'Hiring manager',
    question: 'How does Eddie bring a team along through a migration?',
    lane: 'leadership',
  },
  {
    audience: 'Founder',
    question: 'How does Eddie decide what not to build?',
    lane: 'leadership',
  },
  {
    audience: 'Hiring manager',
    question: 'How does Eddie handle an incident and what changes after?',
    lane: 'leadership',
  },

  // No particular role.
  {
    audience: 'Anyone',
    question: 'What is Eddie worst at?',
    lane: GENERAL_LANE,
  },
  {
    audience: 'Anyone',
    question: 'What does Eddie build outside of work?',
    lane: GENERAL_LANE,
  },
  {
    audience: 'Recruiter',
    question: 'Where has Eddie worked and for how long?',
    lane: GENERAL_LANE,
  },
];

/**
 * Every lane in use, in registry order with the catch-all last.
 *
 * Derived rather than declared, so a suggestion cannot name a lane the chooser
 * does not render.
 *
 * @type {ReadonlyArray<string>}
 */
export const LANES = Object.freeze([
  ...VARIANTS.map((variant) => variant.slug).filter((slug) =>
    SUGGESTED.some((item) => item.lane === slug),
  ),
  ...(SUGGESTED.some((item) => item.lane === GENERAL_LANE)
    ? [GENERAL_LANE]
    : []),
]);

/**
 * @param {string} lane
 * @returns {Suggestion[]}
 */
export function seedsForLane(lane) {
  return SUGGESTED.filter((item) => item.lane === lane);
}

/**
 * The suggestions quoted, joined for a decline message.
 *
 * Quoted verbatim rather than folded into the sentence: a question keeps its
 * inverted word order and will not sit inside a prepositional phrase.
 *
 * @param {number} [limit] How many to name.
 * @returns {string}
 */
export function suggestionSentence(limit = 2) {
  const questions = SUGGESTED.slice(0, limit).map(
    (item) => `“${item.question}”`,
  );

  if (questions.length === 0) return '';
  if (questions.length === 1) return questions[0];

  return `${questions.slice(0, -1).join(', ')} or ${questions[questions.length - 1]}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/web-astro && npx vitest run src/util/air/suggested.spec.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Verify every new seed retrieves context**

This is the check that matters, and it only runs with real content. `offline.spec.ts` skips its corpus assertions when `loadEvalCorpus` returns nothing, which is the state of a keyless checkout.

```bash
# With CONTENT_SEAL_KEY exported and the content unsealed into the section dirs:
cd packages/web-astro && npx vitest run src/util/air/evals/offline.spec.ts
```

Expected: PASS with the corpus assertions actually running (not skipped). If a seed fails to clear the relevance floor, either reword the question toward vocabulary that exists in the corpus, or add the missing vocabulary to the relevant entry's `tags` — do not lower the floor. A seed the corpus cannot answer is a button that declines.

If you do not have the key, say so plainly in the commit body and flag it for the operator task rather than assuming it passes.

- [ ] **Step 6: Run the full check suite**

```bash
yarn ci
```

- [ ] **Step 7: Commit**

```bash
git add packages/web-astro/src/util/air/suggested.mjs packages/web-astro/src/util/air/suggested.spec.ts
git commit -m "feat(air): tag every suggested question with a lane

The lane is a variant slug, so a visitor picking a question tells retrieval
what they are hiring for without a second vocabulary to keep aligned. Adds
three questions per lane for the chooser to rotate through."
```

---

## Task 7: Role-aware A.I.R.

Thread an optional role from the page (or a seed's lane) through the endpoint into retrieval and the prompt, and mount the seed questions on the landing.

**Files:**
- Modify: `packages/web-astro/src/util/air/retrieval.mjs`
- Modify: `packages/web-astro/src/util/air/retrieval.spec.ts`
- Modify: `packages/web-astro/src/util/air/prompt.mjs`
- Modify: `packages/web-astro/src/pages/api/air/ask.ts`
- Modify: `packages/web-astro/src/react/AIResume.tsx`
- Modify: `packages/web-astro/src/react/AskAir.tsx`
- Modify: `packages/web-astro/src/pages/cv/[variant].astro`
- Modify: `packages/web-astro/src/pages/cv/index.astro`
- Create: `packages/web-astro/src/react/SeedQuestions.tsx`
- Create: `packages/web-astro/src/react/SeedQuestions.spec.tsx`

**Interfaces:**
- Consumes: `LANES`, `seedsForLane` from `@util/air/suggested.mjs`; `isVariantSlug` from `@util/resume/variants.mjs`; `AIResume`, `Modal`.
- Produces:
  - `selectContext(question, entries, options?: {role?: string})` — same return shape
  - `buildUserMessage(question, context, options?: {role?: string})`
  - `POST /api/air/ask` accepts `{question: string, role?: string}`
  - `<AIResume variant role seed titleId />`
  - `<AskAir href role />`
  - `<SeedQuestions lanes seeds />`

- [ ] **Step 1: Write the failing retrieval test**

Append to `packages/web-astro/src/util/air/retrieval.spec.ts`:

```typescript
describe('role context', () => {
  const entries = [
    {
      id: 'resume/skills/default',
      data: { section: 'skills', title: 'Skills', tags: ['typescript'] },
    },
    {
      id: 'resume/skills/solutions',
      data: {
        section: 'skills',
        variant: 'solutions',
        title: 'Skills',
        tags: ['typescript'],
      },
    },
  ];

  it('prefers the matching variant when two entries tie', () => {
    const selected = selectContext('typescript skills', entries, {
      role: 'solutions',
    });
    expect(selected[0].id).toBe('resume/skills/solutions');
  });

  it('leaves the order alone when no role is given', () => {
    const selected = selectContext('typescript skills', entries);
    expect(selected[0].id).toBe('resume/skills/default');
  });

  // A boost, never a filter: the best answer wins on relevance regardless of
  // lane. A solutions visitor asking about agents in production still gets the
  // agents answer.
  it('does not drop entries belonging to another variant', () => {
    const selected = selectContext('typescript skills', entries, {
      role: 'solutions',
    });
    expect(selected.map((entry) => entry.id)).toContain('resume/skills/default');
  });

  it('ignores a role that matches nothing', () => {
    const withRole = selectContext('typescript skills', entries, { role: 'nope' });
    const without = selectContext('typescript skills', entries);
    expect(withRole.map((e) => e.id)).toEqual(without.map((e) => e.id));
  });
});
```

Import `selectContext` in that file if it is not already imported.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/web-astro && npx vitest run src/util/air/retrieval.spec.ts
```

Expected: FAIL — the solutions entry does not come first.

- [ ] **Step 3: Implement the retrieval boost**

In `packages/web-astro/src/util/air/retrieval.mjs`, add near `RELEVANCE_FLOOR`:

```javascript
/**
 * How much a matching variant is worth.
 *
 * Small on purpose. Role context breaks ties in framing; it does not decide
 * what is relevant. A visitor in the solutions lane asking about agents in
 * production should still get the agents answer, because that is the true
 * answer to what they asked. Sized below the smallest field weight so it can
 * reorder equals and never outrank a genuinely better match.
 */
export const ROLE_BOOST = 0.5;
```

Then in `selectContext`, accept and apply it. The function already takes an `options` object; add `role` to its destructuring and apply the boost to each scored entry before sorting:

```javascript
export function selectContext(question, entries, options = {}) {
  const { role } = options;
  // ...existing scoring...

  /*
   * The role adjusts the score, it does not gate the set. Applied after scoring
   * so it reorders equals rather than changing what cleared the floor — an
   * entry that would not have been selected without the boost is an entry the
   * question did not ask for.
   */
  const adjusted = scored.map((item) => ({
    ...item,
    score:
      role && item.entry?.data?.variant === role
        ? item.score + ROLE_BOOST
        : item.score,
  }));
```

Sort and slice `adjusted` where the existing code sorted `scored`. Read the surrounding function before editing: the local variable names there are authoritative, and the shape above describes the change rather than the exact lines.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/web-astro && npx vitest run src/util/air/retrieval.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Thread the role through the prompt and the endpoint**

In `packages/web-astro/src/util/air/prompt.mjs`, change `buildUserMessage`:

```javascript
/**
 * @param {string} question
 * @param {Array<object>} context
 * @param {{role?: string}} [options] The role the asker is hiring for, when
 *   they have told us. One line, outside the story tags, because it is a fact
 *   about the reader rather than a fact about Eddie — and everything inside
 *   those tags is data the model is told not to follow.
 */
export function buildUserMessage(question, context, options = {}) {
  const { role } = options;
  // ...existing assembly...
```

Add the line immediately before the question, outside the story tags:

```javascript
  const roleLine = role
    ? `The person asking is hiring for a ${role} role. Choose which true things to lead with accordingly. Do not change any fact, and do not claim experience that is not in the record.\n\n`
    : '';
```

In `packages/web-astro/src/pages/api/air/ask.ts`:

Import the validator:

```typescript
import { isVariantSlug } from '@util/resume/variants.mjs';
import { GENERAL_LANE } from '@util/air/suggested.mjs';
```

After the existing question extraction (around line 208), add:

```typescript
  /*
   * The role is a hint from the page the question was asked on, or from the
   * lane of the seed that was clicked. Validated against the variant registry
   * and dropped otherwise: it reaches the prompt, so an unvalidated string here
   * would be a free line of caller-supplied text inside the system's half of
   * the message. The catch-all lane means "no particular role" and is treated
   * as absent.
   */
  const rawRole = (payload as { role?: unknown })?.role;
  const role =
    typeof rawRole === 'string' && rawRole !== GENERAL_LANE && isVariantSlug(rawRole)
      ? rawRole
      : undefined;
```

Pass it to both call sites:

```typescript
  const selected = selectContext(validated.question, corpus, { role });
```

```typescript
          content: buildUserMessage(validated.question, selected, { role }),
```

Add `role` to the telemetry properties alongside `questionLength` on each capture that already carries it, so the eval and the funnel can tell the lanes apart.

- [ ] **Step 6: Add the React props**

In `packages/web-astro/src/react/AIResume.tsx`, extend `Props` (around line 41):

```typescript
  /**
   * What the asker is hiring for, when the page knows.
   *
   * Sent with the question and used as a retrieval hint. Never rendered: it is
   * context the page already established by being the page it is, and repeating
   * it back would read as the site telling the visitor what they want.
   */
  role?: string;
  /**
   * A question to open with, from a seed the visitor picked.
   *
   * Prefilled rather than submitted: the visitor chose a starting point, not a
   * final wording, and sending it for them removes the edit they may want to
   * make. It also keeps the first model call an act the visitor took.
   */
  seed?: string;
```

Destructure them in the signature and use `seed` as the initial value of the question state. Include `role` in the JSON body of the fetch to `/api/air/ask`.

In `packages/web-astro/src/react/AskAir.tsx`, add to `Props`:

```typescript
  /** Passed through to the dialog. See AIResume. */
  role?: string;
```

Destructure it and pass it: `<AIResume variant="dialog" titleId="air-dialog-title" role={role} />`.

In `packages/web-astro/src/pages/cv/[variant].astro`, add the prop deferred from Task 4:

```astro
{airPath && <AskAir client:visible href={airPath} role={resume.variant} />}
```

- [ ] **Step 7: Write the failing seed-questions test**

Create `packages/web-astro/src/react/SeedQuestions.spec.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { SeedQuestions } from './SeedQuestions';

const seeds = {
  product: [
    { audience: 'Hiring manager', question: 'First product question?', lane: 'product' },
    { audience: 'Client', question: 'Second product question?', lane: 'product' },
  ],
  solutions: [
    { audience: 'Partner', question: 'First solutions question?', lane: 'solutions' },
    { audience: 'Sales engineer', question: 'Second solutions question?', lane: 'solutions' },
  ],
};

function mockMotionPreference(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query.includes('reduce'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  }));
}

describe('SeedQuestions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockMotionPreference(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows one question per lane', () => {
    render(<SeedQuestions seeds={seeds} />);
    expect(screen.getByText('First product question?')).toBeInTheDocument();
    expect(screen.getByText('First solutions question?')).toBeInTheDocument();
    expect(screen.queryByText('Second product question?')).not.toBeInTheDocument();
  });

  it('rotates to the next question in each lane', () => {
    render(<SeedQuestions seeds={seeds} />);
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(screen.getByText('Second product question?')).toBeInTheDocument();
    expect(screen.getByText('Second solutions question?')).toBeInTheDocument();
  });

  // Rotation is decoration. Someone who has asked the system to stop moving
  // things has asked for this too.
  it('does not rotate when reduced motion is preferred', () => {
    mockMotionPreference(true);
    render(<SeedQuestions seeds={seeds} />);
    act(() => {
      vi.advanceTimersByTime(21000);
    });
    expect(screen.getByText('First product question?')).toBeInTheDocument();
    expect(screen.queryByText('Second product question?')).not.toBeInTheDocument();
  });

  it('offers every question as a button, so nothing is unreachable', () => {
    render(<SeedQuestions seeds={seeds} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

```bash
cd packages/web-astro && npx vitest run src/react/SeedQuestions.spec.tsx
```

Expected: FAIL — cannot resolve `./SeedQuestions`.

- [ ] **Step 9: Implement SeedQuestions**

Create `packages/web-astro/src/react/SeedQuestions.tsx`:

```tsx
import React from 'react';

import Modal from './Modal';
import { AIResume } from './AIResume';

/**
 * Lane-tagged seed questions on the CV chooser.
 *
 * ## What this is for
 *
 * The cards ask the visitor to classify themselves by job title, which is a
 * question some people cannot answer about a role they are hiring for. A
 * question they recognise is easier to point at than a category, so these are a
 * second door into the same building: pick the thing you are actually trying to
 * find out, and the answer arrives already framed for the lane it came from.
 *
 * ## Why they rotate
 *
 * Each lane has more questions than fit on a chooser, and showing three per
 * lane at once turns a prompt into a menu. Rotating shows the breadth without
 * spending the space. It stops entirely under `prefers-reduced-motion`: the
 * rotation is decoration, and someone who asked the system to stop moving
 * things has asked for this too. The first question in each lane is the one
 * that stays, so nothing is hidden behind an animation that never runs.
 */

interface Seed {
  audience: string;
  question: string;
  lane: string;
}

interface Props {
  /** Questions by lane, in the order the lanes should appear. */
  seeds: Record<string, Seed[]>;
}

/** Long enough to read a question and decide it is not the one. */
const ROTATE_MS = 7000;

export function SeedQuestions({ seeds }: Props) {
  const lanes = React.useMemo(() => Object.keys(seeds), [seeds]);
  const [tick, setTick] = React.useState(0);
  const [asking, setAsking] = React.useState<Seed | null>(null);

  /**
   * Read the motion preference in an effect, not during render.
   *
   * This island is server-rendered, where there is no matchMedia, and branching
   * on it during render would make the first client render disagree with the
   * server's HTML.
   */
  const [rotates, setRotates] = React.useState(false);
  React.useEffect(() => {
    setRotates(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  React.useEffect(() => {
    if (!rotates) return;
    const id = setInterval(() => setTick((value) => value + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, [rotates]);

  const close = React.useCallback(() => setAsking(null), []);

  return (
    <>
      <ul className="grid list-none gap-3 sm:grid-cols-2">
        {lanes.map((lane) => {
          const pool = seeds[lane] ?? [];
          if (pool.length === 0) return null;
          const seed = pool[tick % pool.length];
          return (
            <li key={lane}>
              <button
                type="button"
                onClick={() => setAsking(seed)}
                className="flex w-full items-center gap-2 rounded-lg border border-hairline bg-surface p-3 text-left font-body transition-colors hover:border-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-underline dark:border-hairline-dark dark:bg-surface-dark dark:hover:border-link dark:focus-visible:outline-link"
              >
                <span aria-hidden="true">✦</span>
                <span>{seed.question}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <Modal
        open={asking !== null}
        onClose={close}
        titleId="seed-dialog-title"
        bodyScrolls={false}
        surface={false}
        widthClass="sm:max-w-3xl"
      >
        {asking && (
          <AIResume
            variant="dialog"
            titleId="seed-dialog-title"
            seed={asking.question}
            role={asking.lane}
          />
        )}
      </Modal>
    </>
  );
}

export default SeedQuestions;
```

- [ ] **Step 10: Run test to verify it passes**

```bash
cd packages/web-astro && npx vitest run src/react/SeedQuestions.spec.tsx
```

Expected: PASS, 4 tests.

- [ ] **Step 11: Mount the seeds on the landing**

In `packages/web-astro/src/pages/cv/index.astro`, add to the frontmatter:

```astro
import { SeedQuestions } from '../../react/SeedQuestions';
import { LANES, seedsForLane } from '@util/air/suggested.mjs';

/*
 * Only the lanes that lead somewhere. A leadership seed is answerable from the
 * existing corpus even though the leadership CV is unwritten, so lanes are not
 * filtered by `availableVariants` — a question the corpus can answer is worth
 * offering regardless of which documents exist.
 */
const seeds = Object.fromEntries(LANES.map((lane) => [lane, seedsForLane(lane)]));
```

Replace the `{/* Task 7 mounts the seed questions here. */}` comment with:

```astro
{
  sections.air && (
    <section aria-labelledby="cv-seeds" class="mb-12">
      <h2 id="cv-seeds" class="mb-3 font-header text-xl">
        Or start with a question
      </h2>
      <p class="mb-4 font-body leading-relaxed">
        Tell it the problem you are trying to solve. It answers from a fixed
        record of the work, and says so when the record does not cover it.
      </p>
      <SeedQuestions client:visible seeds={seeds} />
    </section>
  )
}
```

- [ ] **Step 12: Add an e2e assertion for the flag**

Append to `packages/web-astro-e2e/src/e2e/cv-variants.spec.ts`:

```typescript
test('the chooser offers seed questions when A.I.R. is on', async ({ page }) => {
  await page.goto('/cv/');
  await expect(page.getByRole('heading', { name: /start with a question/i })).toBeVisible();
  const seeds = page.locator('section[aria-labelledby="cv-seeds"] button');
  await expect(seeds.first()).toBeVisible();
});
```

- [ ] **Step 13: Run everything**

```bash
yarn ci && nx e2e web-astro-e2e
```

- [ ] **Step 14: Commit**

```bash
git add packages/web-astro/src/util/air packages/web-astro/src/pages/api/air/ask.ts packages/web-astro/src/react/AIResume.tsx packages/web-astro/src/react/AskAir.tsx packages/web-astro/src/react/SeedQuestions.tsx packages/web-astro/src/react/SeedQuestions.spec.tsx packages/web-astro/src/pages/cv/index.astro packages/web-astro/src/pages/cv/\[variant\].astro packages/web-astro-e2e/src/e2e/cv-variants.spec.ts
git commit -m "feat(air): carry the visitor's role into retrieval and the prompt

The role is validated against the variant registry before it reaches the
prompt, and applied as a boost rather than a filter: a question is answered
by whatever answers it best, and the lane only breaks ties in framing."
```

---

## Task 8: Per-variant PDFs, end to end

**This task changes fingerprinted files, so `pdfs.spec.ts` fails from here until Task 10 regenerates the artifacts. Do not push until Task 10 is done.**

**Files:**
- Modify: `packages/web-astro/src/util/resume/fingerprint.mjs`
- Move: `packages/web-astro/src/pages/cv/print/human.astro` → `packages/web-astro/src/pages/cv/print/[variant]/human.astro`
- Move: `packages/web-astro/src/pages/cv/print/bot.astro` → `packages/web-astro/src/pages/cv/print/[variant]/bot.astro`
- Modify: `packages/web-astro/src/util/resume/resume.data.ts:635`
- Modify: `packages/web-astro/src/components/resume/ResumeVisual.astro`
- Modify: `packages/web-astro/src/components/resume/ResumeFull.astro`
- Modify: `scripts/resume-pdf.mjs`
- Modify: `packages/web-astro/src/pages/api/resume/request.ts`
- Modify: `packages/web-astro/src/pages/api/resume/download.ts`
- Modify: `packages/web-astro/src/react/ResumeDownload.tsx`
- Modify: `packages/web-astro/src/pages/cv/[variant].astro`
- Modify: `packages/web-astro/src/util/resume/pdfs.spec.ts`

**Interfaces:**
- Consumes: `VARIANTS`, `PDF_KINDS`, `pdfKey`, `parsePdfKey`, `pdfFilename`, `DEFAULT_VARIANT` from `variants.mjs`; `availableVariants()` from `load.ts`.
- Produces: `RESUME_PDFS` keyed `` `${variant}:${kind}` ``; `GET /api/resume/download?variant=&format=&token=`; `<ResumeDownload variant />`.

- [ ] **Step 1: Move the print routes**

```bash
mkdir -p packages/web-astro/src/pages/cv/print/\[variant\]
git mv packages/web-astro/src/pages/cv/print/human.astro packages/web-astro/src/pages/cv/print/\[variant\]/human.astro
git mv packages/web-astro/src/pages/cv/print/bot.astro packages/web-astro/src/pages/cv/print/\[variant\]/bot.astro
```

In each moved file, fix the relative style import (`human.astro` only, one level deeper now):

```astro
import '../../../../styles/resume-organic.css';
```

And replace the load call in both, adding the validation:

```astro
import { isVariantSlug } from '@util/resume/variants.mjs';

// ...after the showResumePrint gate:

const variant = Astro.params.variant ?? '';
if (!isVariantSlug(variant)) {
  return new Response(null, { status: 404, statusText: 'Not found' });
}

const resume = await loadResume(variant);
if (!resume) {
  return new Response(null, { status: 404, statusText: 'Not found' });
}
```

`robots.txt.ts` already disallows the `/cv/print/` prefix, which still covers the deeper paths. No change there.

- [ ] **Step 2: Update the fingerprint list**

In `packages/web-astro/src/util/resume/fingerprint.mjs`, replace the two print-route entries and add the registry:

```javascript
export const FINGERPRINTED_FILES = [
  'util/resume/resume.data.ts',
  'util/resume/markup.ts',
  'util/resume/watermark.mjs',
  // The registry decides filenames and which slugs are printable, so a change
  // here changes the artifacts even when no prose moved.
  'util/resume/variants.mjs',
  'components/resume/ResumeVisual.astro',
  'components/resume/ResumeFull.astro',
  'components/resume/ResumeSection.astro',
  'components/resume/PrintContact.astro',
  'layouts/PrintLayout.astro',
  'styles/print.css',
  'styles/resume-organic.css',
  'pages/cv/print/[variant]/human.astro',
  'pages/cv/print/[variant]/bot.astro',
];
```

- [ ] **Step 3: Move the request path**

In `packages/web-astro/src/util/resume/resume.data.ts:635`:

```typescript
export const REQUEST_PATH = '/cv/product/#download';
```

Update the comment above it: `/cv` is now the chooser and carries no download bar, so the footer link has to name a variant. The default variant is the right one for a visitor who arrived without choosing.

- [ ] **Step 4: Honour sectionOrder in the two resume components**

In `ResumeVisual.astro` and `ResumeFull.astro`, replace the hardcoded section sequence with an ordered render driven by `resume.sectionOrder`, defaulting to the established order when it is absent. Add above the template in each:

```astro
/**
 * Section order is part of a framing, not a layout preference.
 *
 * A solutions reader should meet the talks before the stack, because the talks
 * are the evidence for the claim that framing makes. Absent means the
 * established order, so every variant that does not care is unaffected.
 */
const DEFAULT_SECTION_ORDER = [
  'strengths',
  'experience',
  'skills',
  'speaking',
  'education',
] as const;

const order = resume.sectionOrder ?? DEFAULT_SECTION_ORDER;
```

Then render from the order rather than from a hardcoded sequence. The existing template has each section as a contiguous block; wrap each block in a named fragment and iterate:

```astro
{
  order.map((section) => (
    <Fragment key={section}>
      {section === 'strengths' && (
        <!-- the existing strengths block, moved here verbatim -->
      )}
      {section === 'experience' && (
        <!-- the existing experience block, moved here verbatim -->
      )}
      {section === 'skills' && (
        <!-- the existing skills block, moved here verbatim -->
      )}
      {section === 'speaking' && (
        <!-- the existing speaking block, moved here verbatim -->
      )}
      {section === 'education' && (
        <!-- the existing education block, moved here verbatim -->
      )}
    </Fragment>
  ))
}
```

**Move the blocks verbatim.** Do not retype them, do not tidy them, do not change a class. For the default order the rendered output must be byte-identical to what it was, and the golden-render diff is what proves it. Run it before committing:

```bash
cd packages/web-astro && npx vitest run src/util/resume
```

If the golden diff reports a change for the default variant, the move was not verbatim. Fix the markup rather than re-recording the golden.

- [ ] **Step 5: Teach the generator to loop**

In `scripts/resume-pdf.mjs`:

Replace the `VARIANTS` constant (it now describes *kinds*, not variants, and the name collides with the registry):

```javascript
import {
  PDF_KINDS,
  pdfKey,
  pdfFilename,
  VARIANTS as REGISTERED_VARIANTS,
} from '../packages/web-astro/src/util/resume/variants.mjs';

/**
 * The two renderings. Renamed from VARIANTS, which now means something else:
 * a variant is a framing of the CV, and each framing is printed in both of
 * these.
 */
const KINDS = [
  {
    key: 'human',
    printBackground: true,
    fonts: ['400 42px "Caprasimo"', '400 16px "Figtree"'],
  },
  {
    key: 'bot',
    printBackground: false,
    fonts: [],
  },
];
```

Change the `--only` flag to accept `variant:kind` or a bare kind, and add a `--variant` flag. Build the work list after the server is up, by asking the running Worker which variants answer:

```javascript
/**
 * Which variants to print.
 *
 * Asked of the running server rather than of `availableVariants()` directly:
 * that function needs an Astro content runtime, and this script is plain node.
 * A print route that answers 200 is the same condition by a more honest test,
 * because it is the condition the generation actually depends on.
 */
async function printableVariants(baseUrl) {
  const found = [];
  for (const variant of REGISTERED_VARIANTS) {
    const response = await fetch(`${baseUrl}/cv/print/${variant.slug}/human`, {
      redirect: 'manual',
    });
    if (response.ok) found.push(variant.slug);
    else log(`${variant.slug}: no content, skipping`);
  }
  if (found.length === 0) {
    throw new Error(
      'no variant has printable content. The print routes need CONTENT_SEAL_KEY ' +
        'and the plaintext materialized in the section dirs — see docs/RESUME.md.',
    );
  }
  return found;
}
```

Replace the single `for (const variant of variants)` loop with a nested loop over variants and kinds, keying results with `pdfKey(variantSlug, kind.key)`, taking the URL from `/cv/print/${variantSlug}/${kind.key}`, and the filename from `pdfFilename(variantSlug, kind.key)`.

Raise the size budgets, since four PDFs now share the bundle:

```javascript
const MAX_PDF_BYTES = 600_000;
/**
 * Four documents now, not two. The Workers Free bundle ceiling is 3 MB
 * compressed and base64 costs about 1% once gzip runs, so this still leaves
 * room for the rest of the Worker. If a fifth variant makes this tight, the
 * answer is R2 behind a binding, not a bigger number.
 */
const MAX_TOTAL_BYTES = 2_400_000;
```

Update the preservation block (the one that keeps un-regenerated variants) to iterate every `pdfKey(variant.slug, kind)` combination rather than the literal `['human', 'bot']`, and update `renderModule`'s `entry()` to take a composed key and quote it in the emitted object literal. Its `@type` annotation becomes:

```javascript
/** @type {Record<string, GeneratedPdf>} */
```

- [ ] **Step 6: Rewrite the PDF spec against the new shape**

In `packages/web-astro/src/util/resume/pdfs.spec.ts`, change the top:

```typescript
import { parsePdfKey, pdfFilename } from './variants.mjs';

const variants = Object.entries(RESUME_PDFS);
const generated = RESUME_DATA_HASH !== '';
```

Replace the final two filename tests with:

```typescript
    it('is keyed by a registered variant and kind', () => {
      for (const [key] of variants) {
        expect(parsePdfKey(key), key).toBeDefined();
      }
    });

    it('names the file the registry says it should', () => {
      for (const [key, pdf] of variants) {
        const parsed = parsePdfKey(key)!;
        expect(pdf.filename, key).toBe(pdfFilename(parsed.variant, parsed.kind));
      }
    });

    // Two downloads landing in the same folder must not overwrite each other.
    it('gives every generated PDF a distinct filename', () => {
      const names = variants.map(([, pdf]) => pdf.filename);
      expect(new Set(names).size).toBe(names.length);
    });
```

And raise the combined budget assertion to `2_400_000` to match the generator.

- [ ] **Step 7: Thread the variant through request and download**

In `packages/web-astro/src/pages/api/resume/request.ts`, add the import:

```typescript
import { DEFAULT_VARIANT, isVariantSlug } from '@util/resume/variants.mjs';
```

After the body is parsed and the email validated, resolve the variant:

```typescript
  /*
   * Which document this request is for. Defaulted rather than required, so a
   * client that has not been updated still gets the CV it used to get. Validated
   * against the registry because it ends up inside a signed claim: an
   * unvalidated string would be a signature over a slug that names nothing, and
   * the download endpoint would have to guess what to do with it.
   */
  const rawVariant = (payload as { variant?: unknown })?.variant;
  const variant =
    typeof rawVariant === 'string' && isVariantSlug(rawVariant)
      ? rawVariant
      : DEFAULT_VARIANT;
```

Add `variant` to the claims of each issued token, alongside the existing `format` and `email` claims, and append it to each returned download URL:

```typescript
  const url = `/api/resume/download?format=${format}&variant=${variant}&token=${token}`;
```

Read the existing token-issuing block before editing: it issues one token per format, and each of those calls needs the claim. Both, not one.

In `packages/web-astro/src/pages/api/resume/download.ts`:

Import and validate:

```typescript
import {
  DEFAULT_VARIANT,
  isVariantSlug,
  pdfKey,
} from '@util/resume/variants.mjs';
```

After the format check, add:

```typescript
  /*
   * An old link carries no variant. Defaulting rather than rejecting keeps
   * every link issued before variants existed working, and the default is the
   * document those links were issued for.
   */
  const requestedVariant =
    context.url.searchParams.get('variant') ?? DEFAULT_VARIANT;
  if (!isVariantSlug(requestedVariant)) {
    return fail(context, 400, 'That link is incomplete', 'Unknown download format.');
  }
```

After the existing format-claim check, add the same check for the variant:

```typescript
  // The token names the variant it was issued for, for the same reason it names
  // the format: the signature covers the claim, but only if someone checks it.
  const grantedVariant = verified.claims.variant ?? DEFAULT_VARIANT;
  if (grantedVariant !== requestedVariant) {
    return fail(
      context,
      403,
      'That link is for a different file',
      'This link does not open that download.',
    );
  }
```

Replace both `RESUME_PDFS[requested]` lookups and the `decode` call with the composed key:

```typescript
  const key = pdfKey(requestedVariant, requested);
  const pdf = RESUME_PDFS[key];
  if (!pdf || pdf.bytes === 0) {
    console.error(
      `[resume] ${key} is not generated — run \`yarn resume:pdf\``,
    );
    return fail(context, 503, 'Not available', 'The download is not built yet.');
  }
```

Change `decode(format: 'human' | 'bot')` to `decode(key: string)` and key its cache by the composed string. Include the variant in the served log line.

Also update the `fail` helper's "Request a fresh copy" link from `/cv/` to `/cv/product/#download` — `/cv/` is now a chooser with no form on it.

- [ ] **Step 8: Give ResumeDownload its variant**

In `packages/web-astro/src/react/ResumeDownload.tsx`, add props:

```typescript
interface Props {
  /**
   * Which CV this bar belongs to.
   *
   * Sent with the request so the issued token names the variant, and the
   * download endpoint can refuse a token that was minted for a different
   * document. The visitor never sees it; they asked for the CV they are
   * reading.
   */
  variant?: string;
}

export function ResumeDownload({ variant = DEFAULT_VARIANT }: Props = {}) {
```

Include `variant` in the JSON body posted to `/api/resume/request`.

In `packages/web-astro/src/pages/cv/[variant].astro`, pass it:

```astro
<ResumeDownload client:visible variant={resume.variant} />
```

- [ ] **Step 9: Run the checks and expect one known failure**

```bash
yarn ci
```

Expected: `check`, `lint` and `build` green. `test` fails with exactly one failure:

```
Resume data or print layout changed since the PDFs were generated. Run `yarn resume:pdf` and commit the result.
```

If anything else fails, fix it before continuing. That one failure is expected and is cleared in Task 10.

- [ ] **Step 10: Commit**

```bash
git add packages/web-astro/src/util/resume packages/web-astro/src/pages/cv/print packages/web-astro/src/pages/cv/\[variant\].astro packages/web-astro/src/pages/api/resume packages/web-astro/src/react/ResumeDownload.tsx packages/web-astro/src/components/resume scripts/resume-pdf.mjs
git commit -m "feat(cv): key the PDF pipeline by variant slug

Print routes, generation, tokens and serving all take the same slug, so a
token minted for one document cannot fetch another. pdfs.spec.ts fails until
the artifacts are regenerated, which is the next commit."
```

---

## Task 9: Author and seal the solutions variant (operator)

**This task needs `CONTENT_SEAL_KEY` and is Eddie's to run.** It is the only place the real prose is written, and nothing before it can be verified against real content.

**Files (plaintext, gitignored):**
- `packages/web-astro/src/content/resume/.local-profile/solutions.md`
- `packages/web-astro/src/content/resume/.local-strengths/solutions.md`
- `packages/web-astro/src/content/resume/.local-skills/solutions.md`
- `packages/web-astro/src/content/resume/.local-experience/*.md` (edits to existing files)

**Files (committed):** the resulting sealed blobs only.

- [ ] **Step 1: Fix the dyslexia line at its source**

Version C flags that the line is live in two sealed entries: the strengths section, and the Simply Build bullet in an experience entry. The agreed replacement is "an owner who doesn't think in spreadsheets". Under the single-source model this lands once in each file and reaches every variant.

This disclosure belongs to a specific person and is theirs to make. Replace it; do not reword it into a softer version of the same disclosure.

- [ ] **Step 2: Write the three solutions singletons**

From `~/Downloads/resume-version-c-solutions-engineering.md`. Each file needs `variant: solutions` in its frontmatter.

`profile/solutions.md` — headline "Solutions Engineer · Developer Platforms · AI-Native"; a `pitch` line for the chooser card; `sectionOrder: ['strengths', 'experience', 'speaking', 'skills', 'education']` (Version C moves Speaking above Skills); tags carrying the retrieval vocabulary a solutions question arrives in: `presales`, `solutions engineering`, `vendor management`, `developer relations`, `technical evaluation`, `enablement`.

`strengths/solutions.md` — "Partner and vendor development" promoted to first.

`skills/solutions.md` — adds the "Customer-facing" grouping.

Honesty guardrails, verbatim from Version C, on every line of this:

- No quota has ever been carried. Do not imply one.
- Crittercism was "Developer Success Engineer", not presales.
- The Mangomint EAP relationship is one vendor and one business.
- The self-hosting migration is in flight. "Leading migration", never "runs on".
- Agent counts state both numbers: 17 in production of 27 registered.
- Wandering Hearth is concurrent with employment, not after it.
- Verify the Crittercism figures (65%, 3-day SLA, ~10,000 developers) against the source before quoting. Keep the tilde on approximations.

- [ ] **Step 3: Add the emphasis overrides**

In the relevant `.local-experience/*.md` files, add `variants.solutions` blocks with the re-selected `featured` indices and, where Version C rewrote it, a `summary`. The Frontdoor entry drops the Parameter Store bullet from its featured set.

Only `featured`, `summary` and `lede` are permitted here. If a variant seems to need a different fact, the fact belongs in the base entry.

- [ ] **Step 4: Seal and verify**

Follow [Reseal the content vault](../../RUNBOOK.md#reseal-the-content-vault). Then, with the key exported and plaintext materialized:

```bash
cd packages/web-astro && npx vitest run src/util/air/evals/offline.spec.ts
```

Expected: PASS with the corpus assertions running rather than skipped. This is where Task 6's new seed questions are genuinely validated against the real corpus. If a seed declines, reword it or extend the relevant entry's `tags`; do not lower `RELEVANCE_FLOOR`.

- [ ] **Step 5: Commit the sealed blobs**

```bash
git add packages/web-astro/src/content/resume
git commit -m "content: the solutions CV variant, sealed

Three singleton sections plus per-role emphasis overrides. Replaces the
dyslexia disclosure at its source, which under the single-source model
reaches every variant from one edit."
```

Confirm no plaintext was staged: `git show --stat HEAD` should list sealed blobs only.

---

## Task 10: Regenerate the PDFs and close the branch (operator)

**Needs `CONTENT_SEAL_KEY` and the plaintext materialized in the section directories.** `.local-*` working copies alone load zero entries, and without the key the run fails with a 404 on the print route rather than naming the missing key.

- [ ] **Step 1: Regenerate**

```bash
yarn resume:pdf
```

Expected: four documents reported, `product:human`, `product:bot`, `solutions:human`, `solutions:bot`, each with a page count, a size and one watermark slot per page. If the sandbox blocks Chromium, see [Regenerating the PDFs](../../RESUME.md#regenerating-the-pdfs) for the Playwright flag.

- [ ] **Step 2: Verify the artifacts**

```bash
cd packages/web-astro && npx vitest run src/util/resume/pdfs.spec.ts
```

Expected: PASS. The fingerprint failure from Task 8 is now cleared.

- [ ] **Step 3: Check the downloads by hand**

```bash
yarn resume:pdf --keep-pdf
open packages/web-astro/dist/resume-preview/
```

Open all four. Confirm the solutions documents show the solutions headline, the reordered sections (Speaking above Skills), and the re-selected featured bullets. Confirm the product documents are unchanged from what shipped.

- [ ] **Step 4: Clean up the materialized plaintext**

Remove the plaintext from the section directories. Never stage it. `git status` must show nothing but the generated module.

- [ ] **Step 5: Commit the artifacts**

```bash
git add packages/web-astro/src/util/resume/pdfs.generated.mjs
git commit -m "chore(resume): regenerate the PDFs for both variants

Four documents now: the product CV and the solutions CV, each human and ATS."
```

- [ ] **Step 6: Update the docs**

- `docs/CONTENT-MODEL.md` — the `variant`, `pitch`, `sectionOrder` and `variants` fields, who reads each, and the rule that experience overrides carry emphasis only.
- `docs/RESUME.md` — four PDFs, the variant-keyed generated module, the `--variant` flag, and the fact that a variant with no content is skipped rather than stubbed.
- `CLAUDE.md` — the `/cv` route table under "Web-Astro Application Structure", and `util/resume/variants.mjs` in the file listing.

```bash
git add docs/CONTENT-MODEL.md docs/RESUME.md CLAUDE.md
git commit -m "docs: variant fields, routes, and the four-PDF pipeline"
```

- [ ] **Step 7: Full green, then push**

```bash
yarn ci && nx e2e web-astro-e2e
```

Expected: everything green, including `pdfs.spec.ts`.

```bash
git fetch origin master
git rebase origin/master
yarn ci
git push --force-with-lease -u origin feat/cv-role-variants
```

Push over SSH. HTTPS is rejected without the `workflow` scope.

- [ ] **Step 8: Open the PR**

```bash
gh pr create --base master --title "Split CV landing: role variants and role-aware A.I.R." --body "$(cat <<'EOF'
## Summary

`/cv` is now a role chooser. The CV it used to show lives at `/cv/product`, and
`/cv/solutions` reframes the same career for a solutions engineering audience.
Each variant has its own human and ATS PDFs, and A.I.R. carries the visitor's
lane as a retrieval hint.

## Notes for review

- Facts are single-source. Experience entries carry per-variant *emphasis*
  only, so a correction to a bullet reaches every variant from one edit.
- Role context is a boost, never a filter. A solutions visitor asking about
  agents in production still gets the agents answer.
- `/cv/for-bots` stays a single canonical record, so a generative engine never
  has to decide which of three framings is true.
- `/cv/leadership` is registered but unwritten: it 404s and leaves no card.

## Verification

- `yarn ci` green
- `nx e2e web-astro-e2e` green
- Four PDFs regenerated and opened by hand

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_0151UXZWYJPZ6udgGvNGevBs
EOF
)"
```

---

## Deferred

Out of scope for this plan, per the spec:

- **Engineering Leader prose.** The machinery is complete; the variant arrives as a content drop (three singleton files, per-role emphasis overrides, then a PDF regeneration). No code change.
- **A.I.R. access and gating model.** Unchanged.
- **Role-context evals.** The spec calls for cases in the A.I.R. eval harness asserting that the same question shifts framing across lanes while the facts hold. That needs the real solutions corpus to exist first (Task 9), and it grades against a live model, so it belongs in a follow-up alongside the next `scripts/air-eval.mjs` run.
- **Emailed download links** and the other known TODOs.
