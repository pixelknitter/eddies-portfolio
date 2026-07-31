# Phase 3 — Design

The instrumentation design. Still no code — Phase 4 sequences this into shippable
waves.

---

## Decisions carried in

| Decision | Answer |
|---|---|
| Purpose | Debug staging + previews, launch as the destination |
| LLM content | Capture question **and** answer |
| Model flag | Remote config / kill switch, not a powered A/B |
| Session replay | **No** |
| Alerting | **Discord webhooks** — reuse what exists |
| Feedback control | **Binary, plus optional free text** |
| Retention | 30 days fine; shorter if cheap |
| Log vs event | **Collapse into one**, behind a telemetry abstraction |

---

## Two answers that came back differently than expected

### Retention below 30 days is not a setting

I assumed a knob. There isn't one. PostHog's pipeline splits every `$ai_` event
into two copies:

- a **full copy** into the `ai_events` table — deleted after 30 days
- a **trimmed copy** into the `events` table — persists like any event, and
  **never** contains the large properties

The large properties are exactly: `$ai_input`, `$ai_output`,
`$ai_output_choices`, `$ai_input_state`, `$ai_output_state`, `$ai_tools`.

So the 30 days is a **platform-enforced ceiling, not a target you can lower**.
Getting to two weeks would mean a scheduled deletion job against the API — more
moving parts, more secrets, and a cron to maintain, to shave 16 days off a window
that already expires on its own.

**Recommendation: accept 30 days, and reduce *what* is captured instead if you
want less exposure.** Truncating the question to its first ~200 characters, for
instance, cuts the realistic worst case far more than shortening the window does.
Content volume is the lever with actual leverage here; time is not.

Two consequences worth knowing now:

1. **Prompt and answer text is only readable via the `ai_events` table** in
   PostHog's SQL editor — even for a trace from an hour ago. The normal `events`
   table never has it. Anyone debugging needs to know this or they'll conclude
   capture is broken.
2. Metadata — model, tokens, cost, latency, trace ids — persists indefinitely. So
   the cost and performance questions from Phase 2 stay answerable forever; only
   the content expires.

### There is a redaction footgun that would break ingestion

A generic PII scrubber that drops property keys matching `/token/i` will delete
`properties.token` — **which is where the project API key lives** — and every
event 401s with "event submitted without an api_key". This is a real, reported
PostHog issue with no documented list of reserved keys.

Our redaction plan strips tokens from URLs, so this is directly in the blast
radius. **Rule: redact by value and URL shape, never by key name.** It goes in
the design below and in the test.

---

## 1. Architecture — one seam, four layers

You asked to collapse the download log into a single channel and to consider an
abstraction that standardises the layers. That is the right instinct, and it buys
more than tidiness: **a single choke point is the only place redaction can be
enforced and tested.** Phase 1 found that the existing no-PII guarantees are
enforced by specs; a scattered set of `fetch` calls to PostHog could not inherit
that. One module can.

Proposed: `packages/web-astro/src/util/telemetry/`, following the shape the
codebase already uses for `visibility.mjs`, `runtime.mjs` and `access.mjs` —
small modules, narrow exports, a doc comment explaining *why*.

```
util/telemetry/
  index.mjs        the four public functions, nothing else
  redact.mjs       the single sanitiser every payload passes through
  redact.spec.ts   the test that makes the guarantee structural
  transport.mjs    batched fire-and-forget POST to /batch/
  llm.mjs          $ai_trace / $ai_span / $ai_generation builders
```

### The four layers

| Layer | Function | Lands in | When |
|---|---|---|---|
| **Analytics** | `capture(event, props)` | Product analytics | A thing happened worth counting |
| **Traces** | `trace(id)` → `.span()` / `.generation()` | AI observability | LLM request path |
| **Errors** | `recordError(err, context)` | Error tracking (`$exception`) | Something threw |
| **Alerts** | `alert(severity, message, fields)` | **Discord webhook** | Rare and needs a human now |

Logs are deliberately **not** a fifth layer. Workers Logs already exist, are
enabled at 100%, and the `[air]` / `[resume]` prefix convention works. Adding
PostHog log ingestion would be a third destination for the same information.
`console.error` stays as the local breadcrumb; the seam adds the durable,
queryable channel on top.

### Four properties the seam must have

1. **No-op when unconfigured.** If the project key is absent — `astro dev`,
   vitest, a preview whose secret wasn't seeded — every function returns
   immediately. This is not defensive padding; Phase 1 established that
   `readSecret()` returns `undefined` off-Workers *by design*, so unconfigured is
   a normal state, not an error.
2. **Never blocks a response.** Telemetry is dispatched through
   `ctx.waitUntil()` so the visitor's answer is never waiting on PostHog. Nothing
   in the request path ever `await`s a capture.
3. **Never throws.** A telemetry failure must not convert a working answer into a
   502. Every path is wrapped and swallowed, with a `console.error` breadcrumb.
4. **One outbound request per request.** Use `POST /batch/` so a trace, its
   retrieval span and its generation travel together rather than as three
   fetches.

### Why plain HTTP, not `posthog-node`

Verified: capture works over `POST https://us.i.posthog.com/i/v0/e/` (or
`/batch/`) authenticated with the **project token, which is write-only** and safe
to expose. That means:

- no new dependency in the Worker bundle, which matters against the 3 MB Workers
  Free ceiling the resume PDFs are already eating into
- no per-request SDK initialisation, which is precisely the edge-runtime
  anti-pattern PostHog documents for local flag evaluation
- **no new secret** — `PUBLIC_POSTHOG_KEY` is a build-time public value, so it
  needs no `wrangler secret put` and no addition to the `preview.yml` seeding
  block

The one caveat: add `PUBLIC_POSTHOG_KEY` to `build.inputs` in
`packages/web-astro/project.json`, or Nx will serve a cached build that ignores
it. Phase 1 §8 trap #2.

---

## 2. Event taxonomy

### Naming convention

`<domain>_<object>_<past-tense verb>`, lowercase `snake_case`. Domains reuse the
existing log prefixes: **`air`**, **`resume`**, **`site`**. `$`-prefixed names are
PostHog's and are never invented.

Stated once, applied without exception below.

### The events

**A useful simplification:** `$ai_*` events also land in the `events` table as
trimmed copies, so they are queryable as ordinary product-analytics events. There
is no need for a parallel `air_question_asked` event alongside the trace — that
would double the write for one dataset. The trace *is* the event.

| Event | Fired | Where | Properties |
|---|---|---|---|
| `$ai_trace` | every `/api/air/ask` past the gate | server | `outcome`, `tier`, `build_sha`, `model`, `effort`, `grounded`, `question_length`, `from_suggestion` |
| `$ai_span` | retrieval, every ask | server | `retrieved_count`, `retrieved_ids[]`, `top_score`, `floor_cleared`, `overview_fallback` |
| `$ai_generation` | only when the model was called | server | `$ai_model`, `$ai_provider`, `$ai_input`, `$ai_output_choices`, `$ai_input_tokens`, `$ai_output_tokens`, `$ai_latency`, `$ai_total_cost_usd`, plus `stop_reason`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `citation_count`, `verification_reason` |
| `air_answer_rated` | visitor rates an answer | client | `rating` (`up`/`down`), `has_comment`, `comment`, `$ai_trace_id`, `model` |
| `air_access_requested` | `POST /api/air/request` | server | `outcome`, `notified`, `tier` |
| `air_access_approved` | `GET /api/air/approve` | server | `outcome`, `email_sent`, `via` (`browser` / `discordbot` / `other`), `tier` |
| `resume_form_opened` | request form shown | client | `format_intent` |
| `resume_request_submitted` | `POST /api/resume/request` | server | `format`, `outcome`, `notified` |
| `resume_download_triggered` | browser starts a download | client | `path` (`programmatic`/`fallback`), `format` |
| `resume_download_served` | `GET /api/resume/download` | server | `format`, `pages`, `bytes`, `tier` — **no email** |
| `$pageview` | every page | client | manual, on `astro:page-load` |
| `$exception` | anything thrown | server | `$exception_list`, `$exception_fingerprint`, `$exception_level` |

The `outcome` enum, used on three events, is the closed set from Phase 2 Q1:
`answered`, `no_context`, `refusal`, `truncated`, `unparseable`,
`verification_failed`, `upstream_error`, `rate_limited`, `unauthorised`,
`misconfigured`.

`resume_download_served` is the event that **replaces** the
`[resume] served … to <email>` log line — same signal, no PII, queryable.

### Event classes, and what "success" actually measures

Not every event is the same kind of thing, and conflating them is how a funnel
ends up measuring the wrong step. Three classes:

| Class | Events | Read it to answer |
|---|---|---|
| **Funnel** — someone wants something | `resume_form_opened`, `resume_request_submitted`, `air_access_requested` | Is the gate converting? Are people asking? |
| **Operational** — the system did its job | `air_access_approved`, `resume_download_served`, `resume_download_triggered` | Did delivery work? |
| **Diagnostic** — how it behaved | `$ai_trace`, `$ai_span`, `$ai_generation`, `$exception`, `air_answer_rated` | Does it work, and how does it fail? |

These are documentation, not a property — event names filter fine on their own.

**The success measure for A.I.R. is activation, not delivery.** The chain is
*request → approve → code delivered → they actually ask something*, and only the
last step means anything went right. A code that is issued and never used is a
lead that went cold, and it looks identical to a success if you measure at
delivery.

Activation is already in the design and needs no new event: **`grant_type:
'personal'` on `$ai_trace`** means a personally-issued code was used to ask a real
question. It is also the one signal in this chain that **cannot be polluted** — a
link-preview crawler will never ask A.I.R. a question.

That reframes the crawler problem rather than solving it. `air_access_approved` is
operational, so noise in it costs little, and the honest move is to **label the
noise instead of preventing it**: Discord's unfurler self-identifies as
`Discordbot/2.0`, so a `via` property derived from the user-agent makes the
pollution filterable. It won't catch every bot, and it doesn't need to — it
catches the one that is guaranteed to hit this endpoint every single time.

So both events stay, per your read: `air_access_requested` is the lead,
`air_access_approved` is the operational record, and neither is mistaken for the
success metric.

### Autocapture: off. Explicitly.

Normally I'd prefer autocapture, because hand-fired events rot. Here it must be
disabled, and the reason is specific rather than precautionary:

`ResumeDownload.tsx` renders download URLs into the DOM as visible `<a href>`
fallback anchors. Those hrefs contain a base64url token that **decodes to the
requester's email address**. Autocapture records the `href` of clicked elements.
So autocapture on `/air/resume/` would exfiltrate an email on the one page whose
entire premise is publishing no way to contact Eddie — and would trip the
`resume.spec.ts` DOM scan on the way.

Consequences, accepted deliberately:

- `$pageview` is fired manually on `astro:page-load`. This is also the correct
  choice regardless: `<ClientRouter />` is site-wide, so automatic pageview
  capture would fire once per hard load and never on in-site navigation
  (Phase 1 §8 trap #1).
- The Phase 2 Q8 question — which suggested questions get used — needs a
  hand-fired event. Per Phase 2's own instruction, it's cut from Wave 1 and
  folded into `$ai_trace` as a single `from_suggestion` boolean instead. Cheap,
  and it answers the useful half of the question.

---

## 3. Identity

**Anonymous. No `identify` call. No person profiles.**

Set `$process_person_profile: false` on every server event. Verified rationale,
not just instinct:

- **Cost.** Identified events are ~5× the per-event price of anonymous ones
  ($0.000248 vs $0.00005), and PostHog's own guidance is to capture identified
  events only when needed.
- **Privacy.** The only real identity available is the email inside a personal
  access code — a named person you personally approved. Sending it to a vendor is
  a materially different act from HMAC-signing it into a code, and it would put
  an email-shaped string one careless property away from the `resume.spec.ts` DOM
  scan.
- **It buys nothing here.** Cross-session behaviour is meaningless when there are
  no sessions to speak of and the feature is single-turn with no history.

Instead, two properties carry what identity would have:

- `grant_type`: `shared` | `personal` — tells you *whether* a personal grant was
  used without saying whose. Answers the useful question ("are approved people
  actually using it?") with none of the exposure.
- `tier`: from `tierFromRequest`. Note the documented quirk — under `wrangler dev`
  it reports `production`, so local traffic mislabels. Phase 4's verification
  step accounts for this.

`build_sha` from `PUBLIC_BUILD_SHA` acts as the release marker.

### Joining the rating to the generation, without identity

The feedback control needs to attach a rating to a specific answer. Rather than
plumb a distinct id from browser to Worker, invert it:

1. `ask.ts` generates a `traceId` (`crypto.randomUUID()`) and uses it as
   `$ai_trace_id`.
2. It **returns `traceId` in the JSON response** alongside `grounded`, `answer`,
   `citations`, `sources`.
3. `AIResume.tsx` holds it in state and includes it in `air_answer_rated`.

Two events, joined on a trace id, no identity anywhere. This also means a bad
rating leads straight back to the generation, its prompt, and the STAR ids that
produced it — which is exactly the quality loop you asked for.

---

## 4. LLM trace design

### Boundaries

One HTTP request to `/api/air/ask` = **one trace**. It is single-turn with no
conversation state, so trace and request are the same thing. Within it:

```
$ai_trace  (the request)
├── $ai_span       "retrieval"   — always
└── $ai_generation "answer"      — only if the model was called
```

The `$ai_span` for retrieval is the design's load-bearing detail. It exists even
on the `no_context` path, where **no generation happens at all** because the
endpoint declines without calling the model. Without that span, every
"unanswerable question" would be invisible — and Phase 2 ranked that the #2
question. It also means "% of questions answered" is computed as generations over
traces, which is only correct because the trace exists in both cases.

### Where the values come from

| Property | Source | Note |
|---|---|---|
| `$ai_latency` | `Date.now()` delta around the call, **in seconds** | PostHog's unit is seconds, not ms |
| `$ai_input_tokens` / `$ai_output_tokens` | `response.usage` | Currently discarded |
| `cache_read_input_tokens` | `response.usage` | Answers "is the frozen prompt caching?" |
| `$ai_total_cost_usd` | let PostHog compute from model + tokens | Cross-check against `PRICING` in `air-eval.mjs` |
| `stop_reason` | `response.stop_reason` | **The fix for the `max_tokens` blind spot** |
| `$ai_model` | the resolved flag value | Not the hardcoded constant |

`$ai_provider` is `"anthropic"`.

### Redaction plan

Approved: capture question and answer. So `$ai_input` carries the question and
`$ai_output_choices` carries the answer, both in PostHog's chat-message shape.
Privacy mode stays **off** — it exists precisely to exclude those two properties,
which is the opposite of the decision made.

What must **never** appear in any payload, enforced in `redact.mjs`:

| Never sent | Why |
|---|---|
| The `x-air-access` header value | It is a credential, and a personal code decodes to an email |
| Any `token` query parameter value | Decodes to `{email, format}` or `{email, reason}` |
| Query strings on any `/api/*` URL | Blanket rule; strictly stronger than enumerating params |
| Any email address, anywhere | Including in `comment` free text from the rating control |
| The system prompt | Large, byte-identical every time, zero information per event |
| `CONTACT` values | Print-only by design |

Three implementation rules:

1. **Redact by value and URL shape, never by key name.** Stripping keys matching
   `/token/i` deletes `properties.token` and breaks ingestion with a 401. This is
   the footgun above.
2. **Truncate the answer only, at ~2000 characters. The question is sent
   whole.** `validateQuestion` already rejects anything over 500 characters, so
   the question is bounded before it reaches telemetry — a second ceiling would
   add nothing and could cut a sentence mid-clause, which is exactly the
   debugging value being paid for. The answer ceiling exists to bound payload
   size, not to protect anything.
3. **The rating `comment` is a stranger's free text and is the highest-risk new
   field in the design.** It runs through the same email regex as everything
   else, and is truncated.

### The test that closes the Phase 1 gap

Phase 1 found that `resume.spec.ts` already regex-scans the rendered DOM for
email- and phone-shaped strings — but only on one route, and only for what is
*in the document*, not what is *sent over the network*. A `fetch` carrying an
email in a JSON body passes it cleanly.

`redact.spec.ts` closes that, mirroring the pattern `resume.data.spec.ts`
established: build a representative payload for every event in the taxonomy —
including deliberately poisoned inputs (a question containing an email, a comment
containing a phone number, a URL carrying a real token) — run it through the
sanitiser, and assert the serialised output matches none of:

```
/[\w.-]+@[\w.-]+\.\w{2,}/          // email
/\+?\d{3}[\s.-]\d{3}[\s.-]\d{4}/   // phone
/[?&]token=/                       // any surviving token param
```

Plus the inverse assertion, which is the one that would actually catch the
footgun: **`properties.token` must still be present and equal to the project
key.** A sanitiser that passes the PII checks by deleting everything is not a
passing sanitiser.

### Why there is no second DOM test

The obvious instinct is to also add a PostHog-specific DOM assertion. Deliberately
not doing that, because **the existing scan is the stronger guarantee.**
`resume.spec.ts` matches email- and phone-shaped strings against the whole
rendered document without knowing or caring what produced them — so it already
catches a leak from telemetry, from resume data, or from a source neither of us
anticipated. A PostHog-specific test would cover a strict subset of that and would
rot the moment the snippet moved.

The gap that scan leaves is not coverage, it is **scope and diagnosability**: it
covers one route, and only what reaches the DOM. A `fetch` carrying an email in a
JSON body sails past it. `redact.spec.ts` covers precisely that — the outbound
payload — so the two are complementary rather than overlapping.

The one thing worth adding is a **comment**, not a test: a line in
`resume.spec.ts` noting that telemetry output is in scope of the assertion, so
that when it fails the next reader checks telemetry config rather than only
hunting through `resume.data.ts`. That matches how this codebase already records
load-bearing coupling — see the doc comment on `PrintContact.astro`, which exists
for exactly this reason.

### How LLM errors surface — both channels, different jobs

| Condition | Trace | `$exception` | Discord alert |
|---|---|---|---|
| `upstream_error` (SDK threw) | ✅ outcome | ✅ with `error.status`, `error.name` | ✅ |
| `truncated` (`max_tokens`) | ✅ outcome + `stop_reason` | — | — |
| `unparseable` | ✅ outcome | ✅ | — |
| `verification_failed` | ✅ + `verdict.reason` | — | ✅ |
| `refusal` | ✅ + refusal category | — | ✅ |
| `no_context` | ✅ outcome (this is normal) | — | — |
| `misconfigured` (no API key) | ✅ outcome | ✅ | ✅ |

The distinction: the **trace** is the analytical record of every outcome; the
**exception** is for things that are bugs; the **alert** is for things that need
you tonight. `no_context` is a content gap, not a failure, and must never alert —
it is the single most likely outcome on a sparse corpus.

Classifying the SDK error is what makes `upstream_error` actionable at all.
Today an Anthropic 429, a 529, a timeout and a network failure are one
indistinguishable 502. `error.status` and `error.name` separate them, and they are
the difference between "add backoff", "wait it out" and "raise the timeout".

---

## 5. Feature flags

### Two layers, and the rule between them

| Layer | Mechanism | Question | Fails |
|---|---|---|---|
| **Gate** | build-time `PUBLIC_SHOW_*`, **unchanged** | does this exist on this tier? | closed, at build time |
| **Config** | PostHog flag, new | how does an enabled feature behave? | back to the hardcoded default |

The rule: **PostHog flags operate only inside features the build-time gate has
already enabled.** No `PUBLIC_SHOW_*` gate is replaced. Three code comments say
why — most directly `ask.ts`: *"A flagged-off feature whose endpoint still answers
is not gated, it is merely unlinked."* A network-fetched flag cannot provide that
property, and swapping it in would quietly downgrade a security boundary to a
visibility toggle.

### The model flag

One flag, `air-model`, resolving to a model id, defaulting to `claude-opus-5`.

**How it is evaluated** — this is where Phase 1's verification changed the answer.
Local evaluation needs a *feature flags secure API key* and PostHog explicitly
names edge runtimes with the default in-memory cache as causing "performance
issues and inflated costs due to per-request initialization." Their documented
edge answer is a KV-backed external cache provider — real machinery.

None of it is necessary here, because **the flag has no targeting.** It resolves
to the same value for every visitor, so per-user evaluation is work with no
output. So:

- call the public **`/flags` endpoint with the project API key** (public and safe
  to expose — no new secret, no secure key)
- cache the result in **module scope with a short TTL**, so it is fetched once per
  isolate rather than once per request
- on any failure — network, timeout, malformed — **fall back to the hardcoded
  constant** and carry on

That is the same per-isolate-cache shape `access.mjs` already implements and
documents for rate limiting, which means it is a pattern the codebase already
explains to its next reader. It also costs zero added latency on the request
path in the common case.

Every generation carries the resolved model, so a trace is always attributable to
the config that produced it.

**Deliberately not flagged:** `MAX_TOKENS`, `MAX_ENTRIES`, `RELEVANCE_FLOOR`.
Each additional dimension fragments the prompt cache and can drift from the eval
harness's assumptions. `effort` is a reasonable second flag later; start with one.

**Still unconfirmed:** whether the model id should ride a multivariate flag's
variant key or a JSON payload. I did not find the payload shape in the docs I
read and won't assert a signature. It is a 10-minute question at implementation
time, not a design risk.

### What this flag is not

It is a remote config and kill switch. Per your answer and Phase 2's reasoning,
it is **not** a powered A/B: A.I.R. is gated behind a card-distributed code and
currently off in production, so an online experiment would not reach significance,
and splitting traffic across two models fragments a prompt cache that
`SYSTEM_PROMPT` is deliberately structured to keep warm. Model comparison stays
with `scripts/air-eval.mjs` offline; the flag lets you *act* on what the harness
and the ratings tell you, without a deploy.

---

## 6. The feedback control

Binary plus optional free text, per your answer.

- Two buttons under a rendered answer. On click: capture immediately, then reveal
  an optional single-line "anything we got wrong?" box. **The rating is never held
  hostage to the comment** — most people will click and leave, and that click is
  the signal worth having.
- Only shown when an answer rendered. Not on `grounded: false` declines: a decline
  is working-as-designed, and rating it would conflate "bad answer" with "no
  answer" — the exact distinction Phase 2 Q2 exists to preserve.
- Sends `air_answer_rated` with the `traceId` from the response.
- Accessible: real `<button>` elements, `aria-pressed`, keyboard reachable —
  the existing components hold this line and this should too.

This is the only user-visible change in the whole design.

---

## 7. Alerting — Discord, not PostHog

You already have the plumbing, and it is better suited than PostHog alerts for
this case. PostHog alerts evaluate insights on a schedule; a Worker posting to
Discord fires **at the moment of the failure** and does not depend on ingestion
having succeeded. For "a lead was just lost", immediate matters.

- Reuse the existing runtime pattern: `air/request.ts` and `resume/request.ts`
  already `fetch` a Discord webhook from inside the Worker, and
  `util/air/email.mjs` / `util/resume/notify.mjs` already build embeds.
- `DISCORD_ALERT_WEBHOOK_URL` exists today **only as a GitHub Actions secret**. It
  needs adding as a Worker secret on all three tiers — including the
  `preview.yml` seeding block, or previews silently lose alerting. Phase 1 §8
  trap #4.
- **Rate-limit the alerts.** A flapping upstream error could otherwise spam the
  channel. Reuse `createRateLimiter` from `access.mjs` — same module, same
  best-effort per-isolate semantics, already documented.
- Alert-worthy: `upstream_error`, `misconfigured`, `verification_failed`,
  `refusal`, and `resume_request_submitted` with `notified: false`. Nothing else.

---

## 8. Volume and cost

**Assumptions, stated so they can be corrected:** ~300 visits/month to `/`;
A.I.R. at ~30 questions/month once launched; ~10 resume requests/month. Pre-launch
the real numbers are near zero, since production is three routes and the only
traffic is you and CI.

| Product | Estimated monthly | Free tier | Headroom |
|---|---|---|---|
| Product analytics events | ~500 | **1,000,000** | ~0.05% used |
| AI observability events | ~75 (2–3 per question) | **100,000** | ~0.08% used |
| Error tracking | a handful | not confirmed | — |
| Feature flag requests | ~1 per isolate per TTL | not confirmed | — |

Verified: the first 1M product-analytics events per month are free regardless of
anonymous or identified; the first 100k AI observability events per month are
free, and **each generation *and* each span is a billable event** (so the 2–3
events per question matters at scale, if never at this one).

**Nothing here is remotely close to a limit.** At the stated volume this design
costs $0, and would still cost $0 at 100× the traffic. The honest statement is
that volume is not a design constraint for this site — so I have not designed
sampling, and adding it would be complexity bought for nothing.

**If that assumption is wrong**, the order to cut is: `$pageview` first (highest
volume, lowest value here — it answers a question Phase 2 put out of scope),
then the retrieval `$ai_span`, then generation content. Never cut `outcome` or
`stop_reason`; they are the whole point.

**Not confirmed:** error tracking and feature flag free-tier allowances. Both are
in the same order of magnitude of irrelevance at this volume, but I did not
verify the numbers and am not going to state them.

**Worth noting the asymmetry:** PostHog is free here; the LLM calls are not. The
most valuable cost outcome of this work is not managing the PostHog bill, it is
finally being able to see the Anthropic one.

---

## 9. Failure modes

| If | Then | Because |
|---|---|---|
| PostHog is unreachable | Nothing observable happens | Dispatched via `ctx.waitUntil`, wrapped, swallowed |
| PostHog is slow | No user-facing latency | Never awaited before the response returns |
| The project key is unset | Every telemetry call no-ops | Normal state on `astro dev`, vitest, unseeded previews |
| The `/flags` fetch fails | `claude-opus-5` | Hardcoded fallback, module-scope cache |
| A telemetry payload is malformed | That event is lost | Never converts a working answer into a 502 |
| The Discord alert webhook fails | `console.error` only | Alerting must not cascade |
| The redaction rule has a bug | **CI fails** | `redact.spec.ts` runs in `nx test` |

### Latency on the LLM path, specifically

The one thing that could make this design harmful is adding wall-clock time to a
request a visitor is already waiting on. Three properties prevent it: telemetry
is fire-and-forget through `waitUntil`; the flag is read from a module-scope
cache, not the network, on all but the first request per isolate; and the whole
payload is one batched POST rather than three.

Note the correction from Phase 1: Workers Free caps **CPU** time (~10 ms), not
wall-clock. JSON-serialising a payload is CPU, and it is small; an outbound fetch
is wall time and happens after the response. Neither is a problem, but they are
different budgets and conflating them leads to the wrong optimisation.

---

## Gate — resolved 2026-07-30

| Question | Resolution |
|---|---|
| Truncate the question? | **No.** Question sent whole (already bounded at 500 by `validateQuestion`); answer truncated at ~2000. |
| A second PostHog-specific DOM test? | **No.** The existing source-agnostic scan is strictly stronger. `redact.spec.ts` covers the outbound payload — the actual gap — and a *comment* records the coupling. |
| `air_access_approved` crawler pollution | **Keep the event, label the noise** with a `via` property. Approval is operational; the success measure is activation via `grant_type: 'personal'`, which cannot be polluted. |

Phase 3 is closed. Nothing in this document is blocked.

### Carried into Phase 4 as known-unverified

Neither is a design risk; both are minutes of work at implementation time.

- Whether the model id rides a multivariate flag's variant key or a JSON payload.
- Error-tracking and feature-flag free-tier allowances (irrelevant at this
  volume, but unverified, so unstated).
