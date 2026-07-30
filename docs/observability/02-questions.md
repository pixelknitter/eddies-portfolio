# Phase 2 — Questions before events

What this site should be able to answer, ranked by how much the answer would
change a decision you would actually make. No event names here; that is Phase 3.

---

## Decisions carried from Phase 1

| Decision | Answer |
|---|---|
| Purpose | **Debug staging + previews, with launch as the destination** |
| LLM content | **Capture both question and answer** |
| Model flag | **Remote config / kill switch**, plus a feedback control feeding a quality loop |
| Session replay | **No** |
| Deployment | PostHog Cloud, US region, project `534721` |

**Assumed, not confirmed:** traffic is low — order hundreds of visits/month on
`/`, and A.I.R. usage in the low tens of questions/month once launched. Phase 3's
volume estimate states this assumption explicitly and is easy to re-run if
you have a better number.

---

## How this ranking was chosen

"Debug staging and previews, with launch as the destination" inverts the usual
analytics ranking, and it is worth being explicit about why.

Behavioural questions — *how many visitors, which page is popular, where do they
drop off* — need traffic to answer, and for a while the only traffic is you and
CI. Diagnostic questions — *does it work, and when it breaks, how?* — are
answerable at **n=1**, on a preview, today.

So the ranking below favours questions that are actionable on one request. Every
one of them also keeps working after launch, when volume arrives and the
behavioural questions become worth asking. Nothing here needs rebuilding later.

The launch decision itself — *is A.I.R. ready to be found?* — is not a question
PostHog answers. It is a judgement you make, and questions 1 through 4 are the
evidence you would want in hand before making it.

---

## In scope, ranked

### 1. When A.I.R. fails, which failure was it?

**Decision it changes:** what you fix next — and today you cannot tell.

Phase 1 found six distinct failure modes collapsing into two log lines and two
status codes. Most starkly, `stop_reason: 'max_tokens'` is unhandled: a
truncated response throws in `JSON.parse` and logs `[air] model returned
unparseable output`, identical to a genuinely malformed response. **Those two
have opposite fixes** — raise the ceiling versus tighten the schema. A refusal
logs nothing at all.

An Anthropic 429, a 529 overload, a timeout and a network failure are likewise
indistinguishable: all four become one 502 and one `console.error` with an
unclassified error object.

**Minimum data:** one outcome property on every request, drawn from a closed set
(`answered`, `no_context`, `refusal`, `truncated`, `unparseable`,
`verification_failed`, `upstream_error`, `rate_limited`, `unauthorised`,
`misconfigured`), plus `stop_reason` and, on errors, the SDK error's status and
name.

**Supplied by:** LLM tracing, with the non-model outcomes as spans.

**Volume honesty:** actionable immediately. One truncated response on a preview
tells you to raise `max_tokens`.

---

### 2. Which questions can the corpus not answer?

**Decision it changes:** which STAR story you write next, or whether retrieval
is mistuned.

This is the highest-value *ongoing* question, and the one PostHog is genuinely
good at. Two distinct signals already exist in the code and are thrown away:

- **Retrieval returned nothing** — `selectContext` came back empty, the endpoint
  declined, and no model call happened. That is a content gap, stated plainly.
- **Retrieval returned something but the model still declined** — `grounded:
  false` on a real generation. That is either a retrieval-precision problem or a
  genuine gap the guardrails caught.

Distinguishing those two is the whole value. The first says *write about this*;
the second says *the story exists but retrieval or the prompt is not connecting
it*.

**Minimum data:** the question text, the retrieved entry ids and their scores,
the top score versus `RELEVANCE_FLOOR`, whether the overview fallback fired, and
the `grounded` flag.

**Supplied by:** LLM tracing (the retrieval step as a span on the trace, so it
sits alongside the generation it fed).

**Volume honesty:** actionable at n=5. Ten declines is a content backlog.

---

### 3. Was the answer any good?

**Decision it changes:** whether to change the model, the prompt, or the
honesty guardrails.

Every machine-side signal available today measures *whether the guardrails
held*, not whether the answer was useful. That gap is not academic: a model that
declines everything scores perfectly on grounding, refusal rate and cost, which
is the exact failure `docs/AIR-SETUP.md` already warns about for the offline
eval harness ("it scores guardrail adherence, not answer quality").

You chose to add a feedback control, which is the right call — it is the only
thing that turns *"which model is better"* from unanswerable into answerable.

**Minimum data:** a single per-answer rating tied to the trace id, plus the
model and the retrieved ids so a bad answer can be traced back to the story that
produced it.

**Supplied by:** both — a product-analytics event for the rating, joined to the
LLM trace.

**Volume honesty:** every rating is useful on its own; you read them, you do not
aggregate them. That is fine, and it is why this works pre-launch where an A/B
experiment would not.

**Dependency:** needs a small UI addition to `AIResume.tsx`. Phase 4 treats it
as its own wave.

---

### 4. What does an answer cost, and what would launch cost?

**Decision it changes:** the `effort` setting, `max_tokens`, the model, and
whether to make A.I.R. public at all.

Nothing in the request path measures latency, tokens or cost — `response.usage`
is read nowhere. This matters more than it looks, because Phase 1 established
that **adaptive thinking is on by default** on `claude-opus-5` and `ask.ts`
passes no `thinking` parameter. Thinking tokens are being billed right now and
have never been counted.

There is also a prompt-caching question with money attached. `SYSTEM_PROMPT` is
a module constant specifically so it stays byte-identical and caches — but
nobody has ever checked whether it actually does. `cache_read_input_tokens`
answers that directly.

**Minimum data:** wall-clock latency around the call, all four usage fields
(`input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
`cache_read_input_tokens`), the model, and `effort`.

**Supplied by:** LLM tracing. PostHog computes cost from tokens and model; the
`PRICING` table in `scripts/air-eval.mjs` is the cross-check.

**Volume honesty:** a single request tells you the per-answer cost. Multiply by
your own guess for launch volume.

---

### 5. Are the guardrails firing, and on what?

**Decision it changes:** the system prompt, and the honesty guardrail lines in
the STAR bodies.

`verifyAnswer` is the layer that does not depend on the model cooperating — it
rejects a citation to a story retrieval never supplied, which is a fabricated
source. When it fires, that is the model attempting something the prompt told it
not to do, and it is worth knowing which rule and which story.

Likewise `stop_reason: 'refusal'`, which today produces no log line whatsoever.

**Minimum data:** the `verifyAnswer` rejection reason (already computed as
`verdict.reason`), the attempted citations versus the supplied ids, and the
refusal category when one is present.

**Supplied by:** LLM tracing.

**Volume honesty:** rare by design. Every occurrence is worth reading
individually — which makes this a good candidate for an alert rather than a
chart.

---

### 6. Are leads being silently lost?

**Decision it changes:** whether to add an alert, and whether the
fails-open posture is still the right trade.

`POST /api/resume/request` **fails open** on a Discord webhook failure: it logs,
returns `notified: false`, and still serves the download links. That is a
deliberate choice — the visitor gets what they came for — but the consequence is
that **a lead can be lost with no signal reaching you**. Today the only trace is
a `console.error` in Workers Logs, and `docs/RUNBOOK.md` has no procedure for
reading those.

Its sibling `POST /api/air/request` fails *closed* (502). Both postures are
defensible; neither is currently observable.

**Minimum data:** the request outcome plus the `notified` boolean, per endpoint.
No email address needed to answer this one.

**Supplied by:** product analytics.

**Volume honesty:** rare, and high-consequence when it happens. Alert, not chart.

---

### 7. Does the resume funnel actually complete?

**Decision it changes:** whether the lead-capture gate is too much friction, and
whether the two-download-path implementation works.

The gate is the newest and least-exercised feature. Two things are worth knowing:
how many people who open the form finish it, and whether the download actually
lands — Phase 1 found **two distinct paths to the same endpoint**, a
programmatic hidden anchor that browsers can block, plus visible fallback
anchors. If the programmatic path is being blocked, the fallback is doing all the
work and nobody knows.

**Minimum data:** form opened → submitted → token issued → download served,
with the format (`human` / `bot` / `both`) and which path triggered the fetch.
The server-side download event is the authoritative one; it already exists as a
`console.log`.

**Supplied by:** both — client events for the form steps, server-side for the
served download.

**Volume honesty:** near-zero until launch. Instrument it now because it is
cheap and it replaces a PII-bearing log line; do not expect a funnel chart worth
reading for a while.

---

### 8. Which suggested questions get used?

**Decision it changes:** the contents of `suggested.mjs` — which is load-bearing
in two places, since the same array drives both the buttons and the sentence in
the retrieval-decline message.

**Minimum data:** which suggestion was clicked versus a freely typed question.

**Supplied by:** product analytics (autocapture may cover it; Phase 3 decides).

**Volume honesty:** this is the weakest item on the list. Pre-launch, the only
person clicking is you. Included because it is nearly free and it pairs with
question 2 — a suggested question that leads to a decline is a bug you want to
find. **If Phase 3 finds it needs hand-fired events, cut it.**

---

## Explicitly out of scope

Each of these sounds like analytics and would not change anything you do.

| Question | Why not |
|---|---|
| How many visitors does the site get? | Production is one page. The number changes no decision — you would not write differently, or ship differently, at 200 versus 2,000. |
| Which blog post is most read? | The blog is off in production, and you write what you want to write. `docs/VOICE.md` is the authority here, not a chart. |
| Bounce rate, session duration, pages per session | No decision attached on a personal portfolio. These are e-commerce metrics wearing a portfolio costume. |
| Which tech badges or building blocks get hovered? | You are not going to remove a skill because it got fewer hovers. |
| Theme preference split (dark versus light) | You are keeping both regardless. Genuinely zero decisions downstream. |
| Referrer and geography breakdowns | Pre-launch this is you and CI. Post-launch, revisit — it may earn its place once there is a launch to attribute. |
| Core Web Vitals | The site is SSR'd static content with two small islands and one Google Fonts request. There is no performance problem to find, and `web-perf` tooling exists if one ever appears. |
| Scroll depth on the resume | Replay is off by decision, and the resume is collapsible by design — depth would measure the accordion, not interest. |
| Which A.I.R. access code was used | The shared card code is shared by definition, so it identifies a batch, not a person. Not worth a property. |

---

## What PostHog genuinely cannot answer

Worth stating plainly so these are not quietly expected of it later.

1. **Whether an answer was *truthful*.** `verifyAnswer` proves a citation
   points at a story that was actually supplied. It cannot prove the claim is
   faithful to that story — that a "reduced compliance risk" line did not become
   "guaranteed compliance." Only human reading and the offline eval harness
   address this, which is precisely why the honesty guardrails live in the
   content rather than the code.

2. **Whether it worked.** The outcome of a good A.I.R. answer is a reply in
   Discord, an email, a conversation, a job. All of it happens off-platform.
   PostHog can tell you someone asked three questions and downloaded the ATS
   PDF; it cannot tell you they hired you.

3. **Whether a PDF was screenshotted or forwarded.** `docs/RESUME.md` is already
   explicit: screen capture happens in the OS compositor, below the browser, and
   no web API observes it. The watermark is attribution, not prevention, and
   analytics changes nothing about that.

4. **Whether the shared access code has leaked.** A personal code is
   attributable by construction; the shared one is not. A spike in usage is
   suggestive, never conclusive.

5. **The true rate-limit ceiling.** The limiter is per-isolate and in-memory, so
   the effective limit is the configured rate times the isolate count. PostHog
   can count 429s accurately but cannot tell you what the real ceiling was at
   the time.

One thing I expected to be on this list and is not: **prompt-cache
effectiveness is answerable.** `cache_read_input_tokens` is a real number in the
API response, so the "is the frozen system prompt actually caching?" question
belongs in scope — it is question 4.

---

## Verified PostHog specifics

Checked against current docs rather than recalled, because two of my priors were
wrong.

- **Event types:** `$ai_generation`, `$ai_span`, `$ai_trace`.
- **The output property is `$ai_output_choices`**, not `$ai_output` — I had this
  wrong. Privacy mode excludes exactly `$ai_input` and `$ai_output_choices`.
- **Confirmed properties:** `$ai_trace_id`, `$ai_model`, `$ai_provider`,
  `$ai_input`, `$ai_input_tokens`, `$ai_output_choices`, `$ai_output_tokens`,
  `$ai_latency` (seconds), `$ai_total_cost_usd`, `$ai_stream`,
  `$ai_time_to_first_token`, `$ai_tools`.
- **Manual capture works over plain HTTP** — `POST https://us.i.posthog.com/i/v0/e/`
  with `api_key`, `event` and `properties`. This matters for a Cloudflare
  Worker: no SDK dependency required in the request path.
- **Large `$ai_` properties are deleted after 30 days.** Good news for the
  capture-everything choice — the question and answer text is self-expiring, so
  "capture both" is a 30-day debugging window rather than a permanent archive.
  Phase 3 will note this where it affects the redaction plan.

---

## Open questions before Phase 3

1. **Do you want alerts, or just data?** Questions 5 and 6 are rare-but-important
   and suit an alert better than a chart. You already have a Discord alerts
   channel and `DISCORD_ALERT_WEBHOOK_URL`. Should Phase 3 design PostHog alerts,
   route through the existing Discord channel, or leave alerting out entirely?

2. **What shape should the feedback control take?** A binary thumbs up/down is
   the cheapest and gets the most responses. A three-way
   (accurate / not-grounded / unhelpful) would tell you *why* and map onto the
   failure modes in question 1 — at the cost of more friction on a page where
   the visitor is a stranger doing you a favour. My instinct is binary plus an
   optional free-text box, but this is your call and it is a design decision, not
   a technical one.

3. **Is 30-day retention of question and answer text acceptable as the whole
   privacy story?** It is a genuinely good property, and it may be enough on its
   own. If you want shorter, that needs a deliberate scrub rather than a
   setting.

4. **Should the download log line survive?** `download.ts` currently logs email
   and IP to Workers Logs, described in the code as the second attribution
   channel. Once the event exists in PostHog, keeping both means two PII
   channels. Replace it, or keep it deliberately as the belt to PostHog's braces?
