# Phase 4 — Sequenced rollout

Three waves. Each is independently shippable, independently valuable, and
independently reversible. Stop after Wave 1 and you have gained something real.

The arc: **see it → be told about it → act on it.**

---

## Why Wave 1 is LLM tracing and not pageviews

The standard advice is to resist front-loading LLM tracing when basic traffic data
is the actual gap. Here it isn't, and the inventory is what settles it:

- Production is three routes. A pageview install would measure a one-page site.
- Phase 2 put visitor counts, bounce rate and session duration **out of scope**
  with reasons — they change no decision you'd make.
- You chose "debug staging + previews, with launch as the destination."
- The highest-ranked question is *"when A.I.R. fails, which failure was it?"* —
  currently unanswerable, and answerable at **n=1** on a preview today.

So Wave 1 goes where the gap is. It also happens to be the wave with the least
risk attached: **it ships zero client-side JavaScript.** No browser SDK, no
cookie, no autocapture, no consent question, and no way to trip the
`resume.spec.ts` DOM scan. All client-side risk is deliberately deferred to
Wave 3.

---

## Wave 1 — See it

**Server-side A.I.R. tracing, and the telemetry seam it lives in.**

### Answers

Phase 2 questions **1** (which failure), **2** (what the corpus can't answer),
**4** (cost, latency, prompt-cache), and **5** (guardrails firing). Four of the
top five, one wave, no UI change.

### Files

**Create**

| File | Purpose |
|---|---|
| `src/util/telemetry/index.mjs` | `capture`, `trace`, `recordError`, `alert` — `alert` is a no-op stub until Wave 2 |
| `src/util/telemetry/redact.mjs` | The single sanitiser every payload passes through |
| `src/util/telemetry/redact.spec.ts` | Makes the guarantee structural |
| `src/util/telemetry/transport.mjs` | Batched fire-and-forget `POST /batch/` |
| `src/util/telemetry/llm.mjs` | `$ai_trace` / `$ai_span` / `$ai_generation` builders |

**Modify**

| File | Change |
|---|---|
| `src/pages/api/air/ask.ts` | Generate `traceId`; time the call; read all four `usage` fields; classify every exit into the `outcome` enum; record `stop_reason`; emit trace + retrieval span + generation; **return `traceId` in the response body** |
| `packages/web-astro/project.json` | Add `PUBLIC_POSTHOG_KEY` to `build.inputs` — Phase 1 §8 trap #2 |
| `src/env.d.ts` | Declare `PUBLIC_POSTHOG_KEY`, with the same comment discipline as the existing entries |
| `.github/workflows/deploy.yml`, `preview.yml` | Set `PUBLIC_POSTHOG_KEY` at build |

`traceId` is returned in Wave 1 even though nothing consumes it until Wave 3.
It's one field, it's harmless, and it means Wave 3 needs no second edit to
`ask.ts`.

### Deliberately not in Wave 1

**The `max_tokens` fix.** Wave 1 *records* `stop_reason`; it does not add a
`truncated` branch or raise the ceiling. That's the discipline the whole
engagement is built on — instrument, get evidence, then fix. If truncation never
actually occurs, raising `max_tokens` would be a cost increase bought on a
hypothesis. Ship the measurement; let the data justify the change.

This means Wave 1 is **pure instrumentation with no behaviour change**, which is
also what makes its back-out trivial.

### Dependencies

None.

### Verification — MCP-executable

Prerequisite: deploy to a PR preview. `preview.yml` posts the generated A.I.R.
access code to the PR. Then ask four questions chosen to force distinct outcomes:

| Probe | Expected `outcome` |
|---|---|
| "Why should I work with Eddie Freeman?" (from `AIR-SETUP.md`) | `answered` |
| "What is the capital of France?" | `no_context` |
| Repeat probe 1 verbatim, within 5 minutes | `answered`, **with cache reads** |
| A question naming an employer not in the corpus | `no_context` or `verification_failed` |

Then run these checks in order. Steps 1–3 are schema-first per the MCP's own
discipline — never query an event name before confirming it exists.

**1. Do the events exist at all?**
```
call read-data-schema {"query": {"kind": "events"}}
```
Expect `$ai_trace`, `$ai_span`, `$ai_generation`. If absent, capture never
reached PostHog — check that `PUBLIC_POSTHOG_KEY` survived the Nx cache.

**2. Do the properties the design specifies exist?**
```
call read-data-schema {"query": {"kind": "event_properties", "event_name": "$ai_generation"}}
call read-data-schema {"query": {"kind": "event_properties", "event_name": "$ai_trace"}}
```
Expect on the generation: `$ai_model`, `$ai_input_tokens`, `$ai_output_tokens`,
`$ai_latency`, `$ai_total_cost_usd`, `stop_reason`, `cache_read_input_tokens`.
Expect on the trace: `outcome`, `tier`, `grant_type`, `grounded`,
`question_length`, `build_sha`.

**3. Is the `outcome` enum actually closed?**
```
call read-data-schema {"query": {"kind": "event_property_values", "event_name": "$ai_trace", "property_name": "outcome"}}
```
Every value must be from the Phase 3 set. A stray value means a code path exits
without classifying itself — which is the exact blind spot this wave exists to
remove.

**4. Do traces nest correctly, and does the no-generation path work?**
```
call query-llm-traces-list {...}
```
The `no_context` probe must appear as a trace **with a retrieval span and no
generation**. If it's missing entirely, the highest-value signal in the design is
broken.

**5. Is the content actually stored?** This one is non-obvious and would otherwise
look like a failure: the `events` table **never** contains `$ai_input` or
`$ai_output_choices`. They live only in `ai_events`.
```
call execute-sql {"query": "SELECT column_name FROM system.information_schema.columns WHERE table_name = 'ai_events'"}
```
…then select `$ai_input` / `$ai_output_choices` from `posthog.ai_events` using
only columns that lookup confirmed.

**6. Is the frozen system prompt actually prompt-caching?** The Phase 2 Q4
question nobody has ever checked. Compare `cache_read_input_tokens` on probe 1
versus probe 3. Non-zero on the repeat means the cache is working; zero on both
means a silent invalidator, and the byte-identical `SYSTEM_PROMPT` is not buying
what it was designed to buy.

**7. Redaction — the negative checks.** These are pass/fail on privacy, not on
function. Query the captured events and assert **no** match for:

- an email-shaped string in any property
- `token=` anywhere in any property
- the `x-air-access` value
- the system prompt text (large, constant, zero information per event)

And the inverse: `properties.token` must still equal the project key. A sanitiser
that passes by deleting everything is not passing.

> **Filtering note.** Under `wrangler dev`, `tierFromRequest` reports
> `production` — a documented quirk. Local traffic will mislabel. Filter on
> `build_sha`, which CI sets and local builds don't: **absent `build_sha` means
> local.**

### Back-out

Three levels, cheapest first:

1. **Disable without deploying** — unset `PUBLIC_POSTHOG_KEY` and rebuild. Every
   telemetry function no-ops by design, because unconfigured is a normal state.
2. **Revert the wave** — the `ask.ts` changes are additive except the added
   `traceId` response field. Reverting restores current behaviour exactly.
3. **Nothing to undo elsewhere.** No secret was created, no data was deleted, no
   `console.error` was removed. Wave 1 only adds.

### If you stop here

You can see every A.I.R. failure by type, know which questions the corpus can't
answer, know what an answer costs, and know whether prompt caching works. The
`max_tokens`-versus-malformed-JSON ambiguity is resolved. That is the majority of
the value in this plan.

---

## Wave 2 — Be told about it

**Alerts to Discord, the lead and operational events, and collapsing the PII log.**

### Answers

Phase 2 questions **6** (are leads being silently lost) and the server half of
**7** (does the resume funnel complete). Plus it delivers the collapse you asked
for in the Phase 2 gate.

### Files

**Modify**

| File | Change |
|---|---|
| `src/util/telemetry/index.mjs` | Implement `alert()` — Discord webhook, embed built in the style of `util/air/email.mjs`; rate-limited via `createRateLimiter` from `access.mjs` |
| `src/pages/api/air/ask.ts` | Route `upstream_error`, `misconfigured`, `verification_failed`, `refusal` to `alert()`. **Never** `no_context` |
| `src/pages/api/air/request.ts` | `air_access_requested` |
| `src/pages/api/air/approve.ts` | `air_access_approved` with the `via` user-agent label |
| `src/pages/api/resume/request.ts` | `resume_request_submitted`; `alert()` when `notified: false` |
| `src/pages/api/resume/download.ts` | `resume_download_served`; **delete the `console.log` carrying email + IP** |
| `.github/workflows/preview.yml` | Seed `DISCORD_ALERT_WEBHOOK_URL` as a Worker secret |

**Out of band:** `wrangler secret put DISCORD_ALERT_WEBHOOK_URL` on production and
staging. It exists today only as a GitHub Actions secret. Miss the preview
seeding block and **previews silently lose alerting** — the failure already
documented in that step's comment for A.I.R.

### The one deletion in this plan

Removing the `[resume] served … to <email>` log line is the only destructive
change across all three waves, and it is deliberate: keeping it means two PII
channels for one signal. It's recoverable from git history if you want it back.

Sequence it *after* verifying `resume_download_served` lands — replace, don't
overlap-then-hope.

### Dependencies

Wave 1 (the seam). `alert()` is a stub until now.

### Verification — MCP-executable

Exercise on a preview: submit an access request, click the approval link, request
a resume PDF in each format, download both.

> **Rate-limit budget — read this before running the checks.** These probes hit
> the same buckets the E2E suite already runs at the edge of. `POST
> /api/resume/request` allows **5 per 10 minutes per client IP**, and the
> download-gate suite in `resume.spec.ts` spends 4 of them, leaving one slot
> spare. Two consequences:
>
> - Verifying by hand *while* CI is exercising the same preview will produce a
>   `429`, which looks exactly like a broken instrumentation check but isn't.
>   Space the probes, or verify against a preview CI isn't currently touching.
> - The invalid-webhook test below consumes a slot of its own. Budget it.
>
> Also note `x-forwarded-for` cannot be used to isolate probes: the endpoints read
> `cf-connecting-ip` first, and `wrangler dev` supplies it on every request, so a
> spoofed header is never consulted. A `429` during verification is a rate limit,
> not a bug — and `rate_limited` is a legitimate value in the `outcome` enum, so
> it should be *captured*, which is itself a check worth making.

**1. Events exist**
```
call read-data-schema {"query": {"kind": "events"}}
```
Expect `air_access_requested`, `air_access_approved`, `resume_request_submitted`,
`resume_download_served`.

**2. The funnel is queryable end to end**
```
call query-funnel {...}
```
`resume_request_submitted` → `resume_download_served`, broken down by `format`.
This is the wave's headline claim; if the funnel can't be built, the events aren't
joinable.

**3. The crawler label works**
```
call read-data-schema {"query": {"kind": "event_property_values", "event_name": "air_access_approved", "property_name": "via"}}
```
Expect both `discordbot` and `browser`. Only `browser` means the heuristic isn't
firing; only `discordbot` means your own click wasn't recorded.

**4. The fails-open path is now visible**
```
call read-data-schema {"query": {"kind": "event_property_values", "event_name": "resume_request_submitted", "property_name": "notified"}}
```
`true` should appear. To prove the alert path, temporarily point the Discord
webhook secret at an invalid URL on a preview, submit a request, and confirm
`notified: false` is captured **and** that the download links were still served —
the fails-open guarantee must survive instrumentation.

**5. No PII survived the collapse.** Re-run Wave 1's negative checks across the
new events, then confirm `resume_download_served` carries `format`, `pages`,
`bytes`, `tier` and **no email property at all**. This is the check that proves
the collapse actually removed the PII rather than moving it.

### Back-out

- **Alerts only** — unset `DISCORD_ALERT_WEBHOOK_URL`; `alert()` no-ops.
- **Events only** — unset `PUBLIC_POSTHOG_KEY`.
- **The deleted log line** — restore from git history. Note this is the one thing
  that doesn't come back by flipping a variable.

### If you stop here

You find out when a lead is lost, you're told the moment A.I.R. breaks, and you
have stopped writing email addresses and IPs into Workers Logs at 100% sampling.

---

## Wave 3 — Act on it

**The feedback control, the model flag, and the client-side events.**

### Answers

Phase 2 question **3** (was the answer any good) — the one that needs a human
signal — plus the client half of **7**, and it turns everything the first two
waves measure into something you can change without a deploy.

### Files

**Create**

| File | Purpose |
|---|---|
| `src/util/telemetry/client.mjs` | Browser init: autocapture **off**, `$pageview` on `astro:page-load` |
| `src/util/air/model.mjs` | Resolve `air-model` from `/flags`, module-scope cache + TTL, fall back to `claude-opus-5` |
| `src/react/AnswerRating.tsx` | Binary rating + optional free text |
| `src/react/AnswerRating.spec.tsx` | Alongside the existing island specs |

**Modify**

| File | Change |
|---|---|
| `src/layouts/Layout.astro` | Client init, bound on `astro:page-load` — **not** module scope (`ThemeIcon.astro` is the live example of that bug) |
| `src/react/AIResume.tsx` | Render `AnswerRating` when an answer exists; hold `traceId` from the response; emit `air_answer_rated` |
| `src/react/ResumeDownload.tsx` | `resume_form_opened`, `resume_download_triggered` with `path: programmatic \| fallback` |
| `src/pages/api/air/ask.ts` | Use the resolved model instead of the `MODEL` constant |
| `src/pages/api/resume/download.ts` | — |
| `packages/web-astro-e2e/src/e2e/resume.spec.ts` | Add the coupling comment: telemetry output is in scope of the DOM PII assertion |

**One PostHog write required:** create the `air-model` feature flag. That's the
only mutation this plan asks for, and it needs your approval — everything up to
here has been read-only.

### This is the risky wave, and the risk is nameable

Wave 3 introduces browser JavaScript, the first cookie on `eddie.engineering`, and
the possibility of tripping `resume.spec.ts`. Specifically:

- **Autocapture must be off.** With it on, clicked `<a href>` values from
  `ResumeDownload.tsx` carry tokens that decode to emails.
- **The rating `comment` is a stranger's free text** — the highest-risk new field
  in the whole design. It passes through `redact.mjs` like everything else.
- **The rating must not appear on `grounded: false` declines.** Rating a decline
  conflates "bad answer" with "no answer" and would corrupt Q2's signal.

### Dependencies

Wave 1 (the seam, and `traceId` in the response). Wave 2 is not required — Wave 3
can ship directly after Wave 1 if you'd rather have the quality loop before the
alerting.

### Verification — MCP-executable

Exercise on a preview: ask a question, rate it up, ask another, rate it down with a
comment, open the resume form, download both formats.

**1. The rating joins to the generation** — the whole point of the wave.
```
call read-data-schema {"query": {"kind": "event_properties", "event_name": "air_answer_rated"}}
```
Confirm `$ai_trace_id`, `rating`, `has_comment`, `model`. Then `execute-sql`
joining `air_answer_rated` to `$ai_generation` on the trace id and assert the row
matches. **If the join returns nothing, the wave has failed** — an unattributable
rating tells you nothing about which prompt or which STAR story produced the bad
answer.

**2. Ratings are two-valued and both reachable**
```
call read-data-schema {"query": {"kind": "event_property_values", "event_name": "air_answer_rated", "property_name": "rating"}}
```

**3. Both download paths are distinguishable**
```
call read-data-schema {"query": {"kind": "event_property_values", "event_name": "resume_download_triggered", "property_name": "path"}}
```
Expect `programmatic` and `fallback`. If only `fallback` appears, the browser is
blocking the programmatic anchor — which is a real finding, not a broken check.

**4. The flag resolves and is attributed**
```
call feature-flag-get-all {}
```
Confirm `air-model` exists and is enabled. Then check `$ai_model` on generations
matches the flag value. Flip the flag to a different model, ask again, and confirm
the new value appears **without a redeploy** — that is the entire claim of the
remote-config design.

**5. Pageviews survive view transitions.** Hard-load `/`, then navigate to
`/air/` in-page. Two `$pageview` events, not one. One means the init is bound at
module scope instead of `astro:page-load`.

**6. Re-run the negative checks** across every client event, and confirm no
`$current_url` contains `token=`.

**7. `nx test` and the Playwright suite must be green** — specifically
`resume.spec.ts`, which now has telemetry in scope of its DOM scan. This is a
local check, not an MCP one, and it is the one most likely to catch a real
mistake in this wave.

### Back-out

- **The flag** — disable it in PostHog; `model.mjs` falls back to
  `claude-opus-5`. No deploy needed. This is the fastest rollback in the plan.
- **Client telemetry** — unset `PUBLIC_POSTHOG_KEY`; the init no-ops and no cookie
  is set.
- **The rating control** — a UI revert. It is the only user-visible change across
  all three waves, so it is also the only one a visitor would notice being
  removed.

### If you stop here

You have the full loop: you can see what happened, you're told when it breaks, a
human tells you whether the answer was any good, and you can change the model in
response without shipping code.

---

## What this plan does not do

Stated so it isn't assumed:

- **No session replay.** Decided in Phase 2.
- **No sampling.** Phase 3 showed volume uses ~0.05% of the free tier; sampling
  would be complexity bought for nothing.
- **No `max_tokens` change, no prompt change, no retrieval tuning.** Those are
  what the instrumentation is *for*. Fixes come after evidence.
- **No CSP.** There is none today, so nothing blocks the script. Adding one is
  worthwhile on its own merits and would need to allow the existing inline theme
  scripts and Google Fonts — a separate piece of work.
- **No consent banner or privacy policy.** Wave 3 sets the first cookie on the
  domain. Whether that needs a policy page is a judgement I'd flag rather than
  decide: EU-based recruiters are a plausible share of the audience, and there is
  no policy page today.

## Suggested order, and one deviation worth considering

Default: **1 → 2 → 3.**

If the quality loop matters more to you than alerting — and given how you
described the model-and-prompt improvement loop, it might — **1 → 3 → 2** is
equally safe. Wave 3 depends only on Wave 1. The trade is that you'd be running
the resume gate un-alerted for longer, and it fails open, so a lost lead stays
silent.

I'd still lead with Wave 1 either way. It is the only wave that is pure
instrumentation with no behaviour change, no client code, and a one-variable
back-out — which makes it the cheapest possible way to find out whether this whole
design actually works in your runtime.
