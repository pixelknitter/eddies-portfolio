# Observability Wave 3 — the quality loop, and a telemetry package

> **Status:** approved, not yet implemented
> **Date:** 2026-08-02
> **Issues:** #67 (Wave 3), #66 (Wave 2 — alert addition recorded there), #69 (embeddings, downstream consumer of this data), #77 (automating the dispute→eval-case loop)
> **Blocked by:** #68 (Wave 1 telemetry seam) must merge first
> **Deliberately excluded:** cross-page identity, consent UI, session replay — see [Out of scope](#out-of-scope)

## Why

Wave 1 made every A.I.R. outcome visible. It cannot answer the only question
that matters to the person reading an answer: **was it any good.** No amount of
instrumentation infers that. It needs a human to say so.

This wave adds that signal, and moves the telemetry code into packages so the
Worker, the browser and `scripts/air-eval.mjs` share one implementation of the
parts that must not diverge — chiefly redaction.

It is also the wave that produces the evidence #69 is waiting on. That issue
declines to build an embeddings pass until there is data showing whether failed
retrievals are vocabulary mismatches or genuinely absent content. A visitor
telling us "you have a whole post about incident response" settles that in one
sentence; the question text alone frequently does not.

## Design

### Two packages, split by runtime

The split is not stylistic. The two runtimes want opposite things, and the
codebase has already established why for one of them.

`util/flags/client.mjs` rejects PostHog's server SDK with a written rationale:
local evaluation with the default in-memory cache is an anti-pattern in edge
runtimes, and it needs a secure API key seeded on three tiers. That argument is
about the *Worker*. It says nothing about the browser, where the SDK is the
supported path to Surveys and hand-rolling would mean reimplementing survey
mechanics we do not want to own.

```
@eddie/telemetry-core          no dependencies, runs in workerd and Node
  redact.mjs                   the choke point — one implementation, one spec
  transport.mjs                hand-rolled POST /batch          (Worker)
  llm.mjs                      builders for the LLM triad:
                                 $ai_trace / $ai_span / $ai_generation
  index.mjs                    createTelemetry()
  events.mjs                   NEW — names and property shapes for the
                                 non-LLM events, browser and Worker alike

@eddie/telemetry-client        browser only
  index.mjs                    the interface, and a no-op default
  posthog.mjs                  adapter over posthog-js        <- exports "./posthog"

web-astro                      wiring only; imports no PostHog symbol
  layouts/Layout.astro         resolveSections -> init, or not
  react/AIResume.tsx           rating and dispute surfaces
  util/air/model.mjs           air-model flag, server-side
```

The shape mirrors `@eddie/obsidian-publish-core`, which already exists and
describes itself as "pure and dependency-free so it runs in Node and in
workerd". `telemetry-core` makes the same claim and is already true: its four
modules import nothing but each other.

**`scripts/air-eval.mjs` becomes a first-class consumer.** It calls real models
and grades them; emitting the same `$ai_generation` shape production emits puts
eval runs beside production traces in the same views, comparable without a
translation step. Today it reaches across into `web-astro` internals.

**The interface is not vendor-neutral, and does not pretend to be.** The event
model is irreducibly PostHog's — `$ai_trace_id`, `$ai_span`, `survey sent`,
`$survey_id`. An abstraction claiming portability while carrying those property
names costs indirection and buys nothing. The seam earns its keep for two other
reasons: one place that names every event, and one adapter that everything
passes through.

**The Astro coupling dissolves.** The adapter exposes `pageview()`;
`Layout.astro` binds `astro:page-load` to it. No Astro knowledge enters the
package, which is what makes it reusable rather than notionally reusable.

**The no-op default is load-bearing.** `index.mjs` ships an implementation where
every method does nothing, so unconfigured call sites work. This is the
guarantee `createTransport` already makes server-side: telemetry must never be
the reason something breaks.

### The retention rule

Wave 1 established it and this wave states it explicitly, because the first
draft of this design broke it:

> **Content typed to get an answer** — questions — lives in `ai_events`, under
> 30-day content retention.
> **Content volunteered as feedback** — comments — may be retained, because
> sending it is the entire point.

The distinction is consent posture, not sensitivity. A question is typed to get
a result; a comment is submitted knowing it is feedback. It is why `buildTrace`
carries `question_length` and never the question.

Two consequences:

1. **The retrieval span gains the question text when the outcome is
   `no_context`.** A decline never calls the model, so no generation exists and
   the question is currently recorded nowhere. Putting it on the span keeps it
   in `ai_events` with everything else — no new retention category.
2. **A dispute older than 30 days is a count with no question attached.**
   Accepted. Mitigations below.

### Two surveys, not a widget and an event

A decline and a bad answer are opposite failures. Rating both with one control
would put "this was wrong" and "there was nothing here" in one field, and the
distinction would then depend on everyone remembering to filter.

```
grounded: true                      grounded: false
  survey: air-answer-quality          survey: air-decline-dispute
  Q1  helpful?  up / down             Q1  should he be able to answer this?
  Q2  (on down) what was wrong?       Q2  (optional) what were you expecting?
       |                                   |
  survey sent { $survey_id,           survey sent { $survey_id,
                $ai_trace_id, ... }                 $ai_trace_id, ... }
```

Distinct `$survey_id`s keep them separate in the Surveys product while both
render in the Feedback tab of the trace they belong to. An earlier draft used a
bespoke `air_decline_disputed` event; once the dispute carries free text it *is*
a survey, and one mechanism is better than two.

#### Provisioned

Both exist in PostHog as **drafts**, type `api` — headless, because we render the
control ourselves and emit the events. They must be **launched** before responses
are accepted; that is a step in Sequencing, not an assumption.

Responses are keyed `$survey_response_<question_id>`, so these ids are load-
bearing and belong in `events.mjs` rather than inline at a call site.

| | `air-answer-quality` | `air-decline-dispute` |
|---|---|---|
| `$survey_id` | `019fc122-7de8-0000-7fa8-0bf8842ad239` | `019fc122-9c54-0000-b9ef-9a66c58aef0b` |
| Q1 | `4c346a19-…` single_choice, Yes/No | `0c0d27ee-…` open, **optional** |
| Q2 | `a8c1f487-…` open, **optional** | — |
| shown when | `grounded: true` | `grounded: false` |

`air-answer-quality` branches on Q1: `Yes` ends, `No` continues to Q2. The
dispute has no branch — sending it *is* the dispute, and its only question is
optional so a click alone records.

`enable_partial_responses: true` on both, so an answer stored before the optional
question is still a response.

**Both follow-ups are optional.** A dispute must record on the click alone —
requiring a sentence would cost most of the signal.

**Both comments pass through `redact`** before reaching the SDK. That strips
emails and phone numbers. It cannot filter abuse, and this is a stranger writing
about a real person. Volume will be small and the audience is one; that is the
trade being accepted.

### The event contract

`events.mjs` names each event once, in the package both runtimes import. It
covers the events `llm.mjs` does not — that module already owns the `$ai_*`
triad and keeps it. This is what stops `air_answer_rated` drifting into
`air_rating_submitted`, and what makes "every event is redacted" auditable
rather than aspirational.

| Event | Emitted by | Carries |
|---|---|---|
| `survey shown` / `survey sent` | browser | `$survey_id`, `$ai_trace_id`, responses |
| `$pageview` | browser, site-wide mode only | route |
| `resume_form_opened` | browser | funnel step |
| `resume_download_triggered` | browser | funnel step |

### Configuration

```js
posthog.init(key, {
  autocapture: false,               // never — see Verification
  disable_session_recording: true,
  persistence: 'memory',            // no cookie, no localStorage, no banner
  capture_pageview: false,          // bound to astro:page-load instead
})
```

`persistence: 'memory'` keeps ePrivacy consent out of scope: nothing is written
to the visitor's device, so no banner is needed on a portfolio whose first
impression is the point. The cost is identity continuity — a visit to `/cv` then
`/cv/air` reads as two anonymous people, so cross-page funnels do not stitch.
Single-page funnels do, and ask-to-rate happens on one page.

Staged deliberately rather than settled: if the missing stitch turns out to cost
a real answer, adding persistence and a consent gate is contained behind the
same adapter.

### The scope switch

Site-wide and feedback-only are both wanted, so it is a flag rather than a
decision.

```js
// sections.mjs — buildTimeSections, the compiled default per environment
analyticsSiteWide: env.PUBLIC_ANALYTICS_SITE_WIDE === 'true',

// sections.mjs — applyOverrides, same boolean discipline as every section flag
if (typeof flags['analytics-site-wide'] === 'boolean')
  resolved.analyticsSiteWide = flags['analytics-site-wide'];
```

Boolean rather than a string variant because `applyOverrides` already documents
that a missing flag or a string variant must leave the compiled value alone.

**It resolves server-side, at render time.** `Layout.astro` already awaits
`resolveSections`, so the decision is made before a byte ships. A client-side
check would have downloaded the SDK before deciding not to use it.

| State | Behaviour |
|---|---|
| no `PUBLIC_POSTHOG_KEY` | `analytics: false` — nothing loads, privacy page correctly absent |
| `analyticsSiteWide: false` | islands `import()` on demand; content pages carry nothing |
| `analyticsSiteWide: true` | `Layout.astro` binds `astro:page-load`; `$pageview` everywhere |

`collectsData` already folds `analytics` in, so the privacy policy stays in step
without a second switch.

### One addition to Wave 2

Route `air-decline-dispute` responses to the Discord alert in #66 — recorded on
that issue. It is a small addition to its alert list and it stops 30 days
becoming the binding constraint: a dispute gets read while its question still
exists, and the loop ends by adding the question to `evals/cases.mjs`, where git
keeps it forever.

It sits alongside that wave's existing rule rather than inside it. #66 says
**never** alert on `no_context`, because a content gap is not a failure. Still
true. A *disputed* decline is different: a human has looked and said the corpus
should have covered this.

**#77** tracks turning that alert into a pull request. Its binding constraint is
worth knowing here too: eval case files are public and `seal-content.mjs` exists
to keep employers out of them, so no automation may commit stranger-authored
text without a human reading it first.

## Verification

**A spec that fails if autocapture is ever enabled.** `ResumeDownload.tsx`
renders download URLs as visible `<a href>` fallbacks whose tokens decode to the
requester's email, and autocapture records clicked hrefs. A config flag is the
only thing between that and sending a stranger's address to a third party. The
test makes it structural, which is the move `redact.spec.ts` already makes for
redaction.

Beyond that:

- The 42 Wave 1 specs move with `telemetry-core` unchanged. If any needs editing
  to pass, the extraction has changed behaviour and is wrong.
- The adapter is tested against a fake `posthog` object under jsdom: `redact`
  applied to every payload before capture; unconfigured calls no-op; survey
  events carry the right `$survey_id` and `$ai_trace_id`.
- `resolveSections` gains cases for the three scope states.
- Rating must not render on `grounded: false`, and the dispute must not render
  on `grounded: true`.

## Sequencing

1. **#68 merges.** Everything here builds on the Wave 1 seam.
2. **Extraction lands as its own PR** — mechanical, no behaviour change, specs
   move unedited. Reviewable as a move.
3. **Wave 3 on top.**

Both surveys are **created** (ids above) and still **draft**. Launching them is a
one-click action in PostHog and should happen when the code that emits their
events ships, not before — a launched survey with no client is just an empty
response list.

## Open questions

- **Does the follow-up question fire reliably through manual capture?** PostHog's
  own docs note there is no supported way to check whether a user has already
  responded to a given survey/trace pair, so duplicate `survey shown` events are
  possible and skew impression rates. Response counts are unaffected. Worth
  confirming behaviour before trusting an impression-rate number.
- **Surveys is in beta.** The integration may move. The adapter is the blast
  radius if it does.

## Out of scope

- **Cross-page identity and consent UI** — staged, see Configuration.
- **Session replay** — off, and not proposed.
- **The embeddings pass (#69)** — this wave produces its input; deciding it
  before the data arrives is what #69 explicitly declines to do.
- **Moving `util/flags/client.mjs` into a package** — it is server-only and
  unrelated to this seam. Unrelated refactoring.
