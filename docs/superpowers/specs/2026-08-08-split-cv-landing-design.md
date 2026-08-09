# Split CV Landing: Role Variants + Role-Aware A.I.R.

> **Date:** 2026-08-08
> **Status:** Approved design, pre-implementation
> **Sources:** `~/Downloads/resume-version-c-solutions-engineering.md` (Version C),
> `~/Downloads/air-prototype.html` (A.I.R. landing prototype)

## Problem

The CV speaks with one framing (Senior Product Engineer, AI-native) to every
visitor, but the people reading it are hiring for different roles. Version C
proved the same facts reframe cleanly for a Solutions Engineering audience; an
Engineering Leader framing is expected later. The A.I.R. prototype showed a
second idea worth keeping: lane-tagged seed questions let a visitor
self-segment by the problem they are hiring for, conversationally rather than
navigationally.

## Decisions made during brainstorming

1. **`/cv` becomes a pure chooser landing.** The site has been live about a
   week, so there is no SEO equity to protect. The landing is content, not a
   menu: role cards plus seed questions.
2. **Two variants at launch** — Product/AI-native (the current CV) and
   Solutions Engineering (from Version C). Engineering Leader is structural
   only: the machinery supports it, no content is written, no dead link
   appears.
3. **PDFs per variant**, human + ATS each, driven by the variant slug through
   the whole pipeline (print routes, generation, serving).
4. **A.I.R. integration:** seeds on the landing carry a lane into the existing
   dialog; variant pages pass their role into `AskAir`; `/cv/air` stays the
   full chat surface. Role context is a retrieval *boost*, never a filter.
5. **Visual language:** the landing extends the resume's organic design family
   (Caprasimo/Figtree), borrowing the prototype's structures (lanes, framing
   copy, honesty footer) but not its palette.
6. **Content model:** hybrid overlay (Approach 1). Singleton sections
   duplicate per variant where the content genuinely diverges; experience
   stays single-source with per-variant emphasis overrides.

## Routes

| Route | What it is |
|---|---|
| `/cv` | Chooser landing |
| `/cv/product` | Default CV (the current visual resume, moved here) |
| `/cv/solutions` | Solutions Engineering variant |
| `/cv/leadership` | Engineering Leader; 404s until its content exists |
| `/cv/air` | Unchanged full chat; accepts optional role/lane context |
| `/cv/for-bots` | Single complete record + JSON-LD, unchanged; variants link to it `rel=alternate` |
| `/cv/print/[variant]/human`, `/cv/print/[variant]/bot` | Print routes, keyed by slug |

All variant routes and the landing are guarded by `sections.resume`; chat
elements render only when `sections.air` is on. Routes are guarded, not just
nav links.

Link updates that ride along:

- `REQUEST_PATH` (footer "Request a copy") moves to `/cv/product/#download`.
- The print-notice copy ("available at eddie.engineering/cv") stays as is; the
  landing still leads to the PDFs.
- `for-bots`'s alternate link continues to point at the complete record.

## Landing page

Organic design family. Four bands:

1. **Masthead** — the "seams between disciplines" framing rewritten to the
   site's voice (see `docs/VOICE.md`): lead with the visitor's problem, plain
   sentences, evergreen.
2. **Role cards** — one per available variant. Card copy (title plus a
   one-line pitch) comes from each variant's sealed `profile` entry via a new
   optional `pitch` field, so chooser copy lives in the content pipeline and
   the Engineering Leader card appears automatically when its content drops.
3. **Seed questions** — lane-tagged, one visible per lane, rotating through
   each lane's pool (rotation disabled under `prefers-reduced-motion`).
   Picking a seed opens the existing A.I.R. dialog (`AskAir` lift) pre-filled
   with the question and carrying the lane. Hidden entirely when
   `sections.air` is off.
4. **Honesty footer** — "Answers are drawn from a fixed record" plus the
   full-CV link, adapted from the prototype.

## Content model

Schema changes in `src/content.config.ts`:

- **Singleton sections** (`profile`, `strengths`, `skills`) gain an optional
  `variant: 'solutions' | 'leadership'`. Absent means default (product);
  existing files are untouched and remain valid.
- **`profile`** additionally gains optional `pitch` (landing card copy) and
  optional `sectionOrder` (Version C moves Speaking above Skills; ordering is
  part of a framing).
- **`experience`** gains an optional `variants` record for per-variant
  emphasis only: `variants: { solutions: { featured: [...], summary?,
  lede? } }`. Facts stay single-source; a variant re-spotlights bullets and
  swaps the condensed opener, nothing else.
- **`speaking` and `education`** stay singleton and shared (Version C changed
  neither's content).

The deciding test for this model: where does a correction land? Each fact
lives in one file (a fix propagates to every variant automatically); each
framing lives in one file per variant (a reframe stays contained). Full
duplicate trees would multiply every fact by the variant count and pollute the
A.I.R. corpus with near-duplicates; presentation-only configs would put
rewritten prose in code, outside the sealed pipeline and invisible to A.I.R.

## Loader and variant registry

- `loadResume(variant = 'product')` — singletons resolve variant-first with
  fallback to default; roles apply the matching `variants[variant]`
  overrides. Same `Resume` shape out (plus `sectionOrder`), so the rendering
  surfaces keep their current props.
- `availableVariants()` — which variants have a profile entry. Drives the
  landing cards, the leadership 404, and the PDF generation loop.
- `util/resume/variants.mjs` — the single authoritative list of variant slugs
  and route paths, read by the loader, the landing, the print routes, and the
  PDF script. Same single-list discipline as `CORPUS_COLLECTIONS`, for the
  same reason: two lists drift.
- **Fixtures** — `sample-solutions-*` files per new section, so preview tiers
  and CI exercise variant pages. The existing `sample-` filtering rule
  applies unchanged.

## A.I.R. role context

- Variant singletons flow into the corpus through the existing `resume` entry
  in `CORPUS_COLLECTIONS` — no new collection, no duplicated role entries.
  Their `tags` carry role vocabulary ("presales", "solutions engineering",
  "vendor management"), which retrieval already weights at 3x.
- `ask` accepts an optional `role` context (from a seed's lane or the
  referring variant page). Retrieval adds a modest boost to entries whose
  `variant` matches; the prompt gains one line ("the asker is hiring for a
  [role] role"). Guardrails are unchanged.
- Role context is a boost, not a filter: the best answer to a question wins on
  relevance regardless of lane; the lane breaks ties in framing.
- `SUGGESTED` in `util/air/suggested.mjs` restructures to carry a `lane` per
  question, seeded from the prototype's pool. The offline-spec rule extends:
  every seed must retrieve context or the build fails.

## PDFs

The variant slug is the single key end to end:

- **Print routes** validate the slug against `variants.mjs`, call
  `loadResume(variant)`, render the shared layout. Unknown slug or missing
  content 404s.
- **Generation** — `yarn resume:pdf` iterates `availableVariants()` x {human,
  bot}: four PDFs at launch. Same prerequisites as today (`CONTENT_SEAL_KEY`,
  materialized plaintext). `pdfs.generated.mjs` records entries keyed
  `{variant, kind}`.
- **Serving** — the download endpoint takes variant + kind, looks up the
  bundled PDF, watermarks per-requester as today. `ResumeDownload` gains a
  `variant` prop; each variant page passes its slug.
- **Fingerprint** — `FINGERPRINTED_FILES` gains `variants.mjs` and the
  renamed print routes. One fingerprint covers the whole set: a
  variant-affecting change regenerates all four, correct because they share
  layout and data source.
- **Engineering Leader** — no content, no PDFs, no print output; the loop
  skips it.

## Testing

- **Unit** — `load.ts` variant fallback, override application,
  `availableVariants()`, unknown-variant handling; `variants.mjs` shape spec;
  offline spec extended to every lane seed.
- **E2E** (fixture-driven, runs in CI) — landing renders one card per
  available variant with no dead links; a card click lands on a variant page
  showing that variant's headline; the download bar appears per variant;
  seeds hidden when A.I.R. is off.
- **Existing guards hold** — `pdfs.spec.ts` regeneration drift (now four
  PDFs), `check-gated-assets` (PDFs stay bundled, never in `public/`),
  golden-render diff for the visual page.
- **Evals** — role-context cases in the A.I.R. eval harness: same question,
  different lane, assert the framing shifts while facts hold.

## Content prerequisite (operator-run)

Version C flags that the dyslexia line is still live in two sealed entries
(strengths, and the Simply Build bullet). The agreed replacement is "an owner
who doesn't think in spreadsheets". That edit is sealed-content operator work
(reseal is key-gated) and should land with or before this feature. Under the
single-source model it lands once.

## Out of scope

- Engineering Leader prose (arrives later as a content drop: three singleton
  files, per-role emphasis overrides, then PDFs).
- Any change to the A.I.R. access/gating model.
- The `for-bots` page beyond keeping its links correct.
- Emailed download links and other items on the known-TODOs list.
