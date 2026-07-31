# Phase 1 — Inventory

What exists today, before any instrumentation decision is made. Read the
headline first: it changes what Phase 2 should even ask.

> **Status:** complete. Nothing in this document changes code. Line references
> were taken from the working tree on 2026-07-30, which contains uncommitted
> resume work — see [Drift from the docs](#drift-from-the-committed-docs).

---

## Headline: production is three routes

`.github/workflows/deploy.yml` sets **no `PUBLIC_SHOW_*` flags on the production
build**, with the reason stated in a comment:

> No `PUBLIC_SHOW_*` flags: every section stays off in production until it is
> finished. A.I.R. included — an access code gates the answers, but the page,
> the nav link and the endpoints were all reachable, and it is not ready to be
> found. Staging has it on for review.

Because every flag is read at build time and every gated route returns 404 when
its flag is off, the entire public surface of `eddie.engineering` today is:

| Route | Notes |
|---|---|
| `/` | Home — hero, `about.md`, badges, building-blocks grid |
| `/404` | Everything else lands here |
| `/robots.txt` | Per-tier, `Disallow: /` on every non-production tier |

`/blog/`, `/works/`, `/projects/*`, `/air/`, `/air/resume/*` and all five API
endpoints 404 in production. Staging and per-PR previews turn six flags on.

**Consequence for this engagement.** Product analytics installed on production
today would measure a one-page site with no interactions and no LLM traffic. LLM
tracing would receive zero traces, because `/api/air/ask` is not reachable. This
does not make instrumentation pointless — but it means the sequencing question
is *"instrument now so the data exists on the day a flag flips,"* not *"find out
what visitors are doing."* Phase 2 has to be honest about which questions are
answerable before launch and which are bets on future traffic.

This is the first open question at the bottom.

---

## 1. Application shape

### Stack

| Thing | Value | Source |
|---|---|---|
| Astro | 7.1.3 | root `package.json` (no per-package `package.json`) |
| Adapter | `@astrojs/cloudflare` 14.1.4 → **Workers** | `astro.config.mjs` |
| Output | `output: "server"` (SSR) | `astro.config.mjs` |
| React | 19.2.0, via `@astrojs/react` 6.0.1 | root `package.json` |
| Package manager | Yarn 3.8.2 (Berry, node-modules linker) | `.yarnrc.yml` |
| Node | 22.12.0 | `.nvmrc` |
| Nx | 23.1.0, `defaultProject: web-astro` | `nx.json` |
| Wrangler | ^4.83.0, `compatibility_date: 2026-04-15`, `nodejs_compat` | `wrangler.jsonc` |
| Tests | Vitest ^1.6.1 (unit), Playwright ^1.62.0 (e2e) | root `package.json` |

Two config details that directly constrain instrumentation:

- **`site` is hard-pinned to `https://eddie.engineering` on every tier**
  (`astro.config.mjs`). `Astro.site` is therefore useless for deriving an
  environment label. Use `tierFromRequest` (`src/util/air/tier.mjs`) instead —
  it reads the `Host` header per request and returns `production` / `staging` /
  `dev`.
- **`platformProxy: { enabled: false }`**, so `astro dev` has no Cloudflare env.
  Anything read through `readSecret()` is `undefined` under `astro dev` by
  design.

### Rendering model, per route

`output: "server"` means every route is SSR on the Worker unless it opts out.
Exactly one route opts in to prerendering:

| Route | Rendering | Where instrumentation must live |
|---|---|---|
| `/projects/<slug>/` | **Prerendered** (`export const prerender = true`) | Client only — never touches the Worker |
| `/robots.txt` | SSR, explicit `prerender = false` | Server |
| Everything else | SSR (default) | Server, client, or both |

A subtlety: `getStaticPaths()` in `projects/[...slug].astro` returns `[]` when
`PUBLIC_SHOW_PROJECTS` is unset, so **the current production build emits no
prerendered HTML at all**. The one static route is static in principle only.

Also note `StarSpotlight.astro` calls `Math.random()` at request time to pick a
spotlight. It depends on per-request rendering; any page-level caching added
later would change its behaviour.

**There is no `src/middleware.ts`.** The only middleware in `dist/` is Astro's
virtual stub. A middleware is a clean greenfield insertion point for
server-side capture that would cover every SSR route in one file.

### Build and deploy

Three tiers, each its own Worker. Tier is resolved from the `Host` header at
request time, not from a build variable.

| Tier | Worker | Hostname | Flags at build |
|---|---|---|---|
| production | `eddies-portfolio` | `eddie.engineering` | **none** |
| staging | `eddies-portfolio-staging` | `staging.eddie.engineering` | 6 flags on |
| dev preview | `eddies-portfolio-pr-<N>` | `<branch>-dev.eddie.engineering` | 6 flags + optional `PUBLIC_SHOW_FIXTURES` |

`workers_dev: true`, so `*.workers.dev` is also live; unrecognised hosts fall
through to `dev` in `tierFromHostname`.

---

## 2. Route and interaction inventory

### Pages

| URL | File | Gate |
|---|---|---|
| `/` | `pages/index.astro` | none |
| `/404` | `pages/404.astro` | none |
| `/blog/` | `pages/blog.astro` | `showBlog` |
| `/blog/<slug>/` | `pages/blog/[...slug].astro` | `showBlog` + per-entry `isPublished` |
| `/works/` | `pages/works.astro` | `showProjects` |
| `/projects/<slug>/` | `pages/projects/[...slug].astro` | `showProjects` |
| `/air/` | `pages/air/index.astro` | `showAIR` |
| `/air/resume/` | `pages/air/resume/index.astro` | `showResume` + resume must load |
| `/air/resume/for-bots` | `pages/air/resume/for-bots.astro` | `showResume` |
| `/air/resume/print/human` | `pages/air/resume/print/human.astro` | `showResumePrint` — **404 on every deployed tier** |
| `/air/resume/print/bot` | `pages/air/resume/print/bot.astro` | `showResumePrint` — **404 on every deployed tier** |

The two print routes are set only by `scripts/resume-pdf.mjs` during local PDF
generation. They are unreachable everywhere else, by design.

### Endpoints

| URL | Method | Gate | Outcome shape |
|---|---|---|---|
| `/robots.txt` | GET | none | Per-tier body, `cache-control: public, max-age=300`, `vary: host` |
| `/api/air/ask` | POST | `showAIR` | 404 / 401 / 429 / 400 / 200-ungrounded / 502 / 503 / 200-grounded |
| `/api/air/request` | POST | `showAIR` | 404 / 429 / 400 / 503 / **502 (fails closed)** / 200 |
| `/api/air/approve` | **GET** | `showAIR` | HTML page; mints a code and sends email |
| `/api/resume/request` | POST | `showResume` | 404 / 429 / 400 / 503 / 200 (**fails open**, reports `notified: false`) |
| `/api/resume/download` | GET | `showResume` | 404 / 429 / 401 / 200 + watermarked PDF |

Three things worth flagging for event design:

1. **`/api/air/ask` has an unusually rich natural funnel** — seven distinct
   outcomes, several of which return HTTP 200. Status code alone will not
   separate them.
2. **`/api/air/approve` is a GET.** The code notes that link-preview crawlers
   can trigger it. Any event on this path will be polluted by Discord's
   unfurler, and the send is idempotent so this is currently harmless — but it
   would make an "approvals" metric wrong.
3. **The two request endpoints have deliberately opposite failure postures** —
   A.I.R. fails closed on a Discord failure (502), resume fails open (200 +
   `notified: false`). That asymmetry is intentional and any "request failed"
   metric must respect it.

### Non-navigation interactions

Only two routes hydrate React. Everything else ships the theme script, the
scroll-animation script, and `<ClientRouter />`.

**`/air/` — `react/AIResume.tsx`** (`client:load`)

- Access-code password input
- "Ask Eddie for access" → opens `Modal.tsx`
- Question input, Enter to submit → `fetch('/api/air/ask')`
- Suggested-question buttons (each carries an `audience` badge)
- Access-request form → `fetch('/api/air/request')` with `{email, reason}`
- Render states worth eventing: `sent`, `failed`, `error`, `grounded: false`,
  grounded-with-sources

**`/air/resume/` — `react/ResumeDownload.tsx`** (`client:visible`)

- Two format buttons (`human`, `bot`)
- Request form → `fetch('/api/resume/request')` with `{email, reason, format}`
- **Two distinct download paths to the same endpoint:** a programmatic hidden
  `<a download>` click, and visible fallback anchors in the success panel. A
  naive client-side "download" event double-counts; the programmatic one can
  also be blocked by the browser.
- Downloads are staggered 400 ms apart to dodge browser throttling

**`/air/resume/` inline script** — expand-all / collapse-all, plus per-`<details>`
toggle listeners. Correctly bound on `astro:page-load`.

**Site-wide** — theme toggle (`ThemeIcon.astro`), footer `mailto:` which swaps
to the resume request form on resume routes, and outbound `target="_blank"`
links to GitHub and LinkedIn.

**Absent:** no copy-to-clipboard anywhere, and no native `<form>` with a server
action — both forms are React `onSubmit` + `fetch`.

---

## 3. LLM layer

### There is exactly one runtime LLM call

`packages/web-astro/src/pages/api/air/ask.ts` — one `client.messages.create()`
inside `POST`. That is the entire runtime LLM surface of the site.

| Property | Value |
|---|---|
| Provider | Anthropic direct (`@anthropic-ai/sdk` 0.115.0) |
| Model | `claude-opus-5`, hardcoded as `MODEL` |
| Shape | **Single call, single turn.** No agent loop, no tools, no follow-up |
| Streaming | **No** — non-streaming, returns one JSON blob |
| Structured output | `output_config.format` = `json_schema` (`ANSWER_SCHEMA`) |
| Effort | `output_config.effort: 'low'` |
| `max_tokens` | 2000 |
| Retrieval | Yes — deterministic lexical BM25-ish, no embeddings |
| Retries / timeout | **SDK defaults only.** No explicit `maxRetries`, no `timeout`, no `AbortSignal` |

One offline call site exists: `scripts/air-eval.mjs`, a multi-model eval sweep
run by `.github/workflows/air-evals.yml` on `workflow_dispatch` and a weekly
cron. It imports the *same* prompt and retrieval modules as production.

`packages/web-astro/gen-resume-content.mts` is **not** an LLM call site — it is a
one-shot content migration script marked for deletion. It should be struck from
any instrumentation list.

### Prompts

One module: `src/util/air/prompt.mjs`. No prompt files, no prompt config service.

- `SYSTEM_PROMPT` is a module-level template literal, **byte-identical across
  requests so it prompt-caches.** Sections: what may be used, rules against
  inventing employer/title/date/duration/tech/team-size/metric, prompt-injection
  handling, and voice.
- `buildUserMessage()` renders `<story id="…">` blocks plus a `<question>` block.
- `verifyAnswer()` is a post-hoc check that runs in production on every
  response: it rejects empty answers, declines-with-citations,
  grounded-with-no-citations, and any citation to an id retrieval never supplied.

The **honesty guardrails** are authored content, not code — a blockquoted line
at the end of each STAR markdown body. `ask.ts` maps `star` bodies to
`constraints`, `normaliseConstraint()` strips the markup, and
`buildUserMessage()` hoists them *above* the story tags as `<constraint for="…">`
blocks, because everything inside the story tags is introduced as data and
constraints are instructions.

### Context assembly

`src/util/air/retrieval.mjs` — deterministic lexical scoring with field weights
(`title:4, tags:3, result:2, situation/task/action:1`), a relevance floor of 3,
and **`MAX_ENTRIES = 4`**. No embeddings, no vector store. There is an
overview-question fallback that ranks by corpus-wide tag recurrence, consulted
only when nothing clears the floor. Tie-breaks are stable on id specifically so
drift evals don't report noise.

The corpus is bundled at build time from three collections: `star`,
`projects`, and `resume`.

### Request path, end to end

```
AIResume.tsx  ─ fetch POST /api/air/ask, header x-air-access
      │
      ▼
ask.ts POST
  showAIR gate ...................... 404
  access check (shared or signed personal code) ... 401
  rate limit on cf-connecting-ip .... 429
  request.json() .................... 400
  validateQuestion .................. 400
  getCollection star|projects|resume  → corpus
  selectContext(question, corpus)
  ├─ empty → 200 {grounded:false} ... ★ NO MODEL CALL
  readSecret ANTHROPIC_API_KEY ...... 503
  ★ messages.create(claude-opus-5, effort:low, json_schema)
  ├─ throws → 502
  ├─ stop_reason 'refusal' → 200 {grounded:false}   (logs nothing)
  ├─ JSON.parse throws → 502
  ├─ verifyAnswer fails → 200 {grounded:false}
  └─ 200 {grounded, answer, citations, sources}
```

**No session or conversation state anywhere.** Single-turn only, no
`conversationId`, no history, no cookies, no Durable Object. The `SESSION` KV
binding is adapter-generated and pinned per tier, but **no application code
reads it**. The access code lives in React state and is lost on reload.

### Error handling today, and what it hides

| Condition | Today |
|---|---|
| Model call throws | 502 + `console.error('[air] model request failed', error)` — **the raw error is logged but never classified.** A 429 from Anthropic, a 529 overload, a timeout and a network failure are indistinguishable in both the response and the log |
| `stop_reason === 'refusal'` | 200 `{grounded:false}` and **no log line at all** — currently invisible |
| Unparseable JSON | 502 + `console.error('[air] model returned unparseable output')` — the offending text is not logged |
| `verifyAnswer` fails | 200 `{grounded:false}` + a log line with the reason |
| Retrieval empty | 200 `{grounded:false}`, no model call |

**`stop_reason === 'max_tokens'` is not handled at all.** This matters more than
it looks. `claude-opus-5` runs adaptive thinking by default when no `thinking`
parameter is passed, and `ask.ts` passes none — so thinking is on, and
`max_tokens: 2000` is a hard ceiling on **thinking plus response text
together**. A truncated response falls through to `JSON.parse()`, throws, and
logs `[air] model returned unparseable output` → 502.

So "the model was cut off mid-thought" and "the model emitted malformed JSON"
produce the identical log line and status code, and they have opposite fixes —
raise the ceiling versus tighten the schema. Distinguishing them costs one
property.

### What is not measured

- **No latency measurement** in the request path. Nothing wraps the call.
- **No token counts.** `response.usage` is never read. All four fields
  (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`,
  `cache_read_input_tokens`) are discarded.
- **No cost measurement.**
- No `ctx.waitUntil`, so there is no existing async hook for telemetry.
- Rate limiting is **per-isolate and in-memory**, documented as best-effort:
  the effective ceiling is the configured rate times the isolate count.

The eval harness is the counter-example and the model to copy: it already
measures latency with `process.hrtime.bigint()`, reads
`response.usage.input_tokens` / `output_tokens`, and prices them from a
`PRICING` table. Its `claude-opus-5` row — **$5 / $25 per MTok** — is correct
against the current Anthropic pricing.

---

## 4. Existing telemetry

**There is none.** Grepping `packages/web-astro/src` for `posthog`, `plausible`,
`umami`, `gtag`, `googletagmanager`, `fathom`, `sentry`, `opentelemetry`,
`datadog`, `axiom` and `sendBeacon` returns only resume *content* text and one
skill badge that happens to be labelled "Sentry".

What does exist:

- **Workers Logs** — `"observability": { "enabled": true }` in `wrangler.jsonc`,
  **with no sampling rate set, so 100% of invocations are logged.** This is the
  only telemetry in place.
- **`console.*` as de facto logging** — 19 calls across 7 files, 17 of them in
  the five API endpoints. All but one are `console.error` / `console.warn`. The
  exception is the only success log in the codebase, in
  `api/resume/download.ts`:
  `[resume] served <format> to <email> (<ip>, <pages>pp, <bytes>b)`. It is
  described in the code as the second attribution channel, and **it contains
  PII** — see §6.
- **A log-prefix convention already in use:** `[air]`, `[resume]`,
  `[latest-work]`. Worth reusing as an event namespace.

What does *not* exist, despite being available on the platform:
`analytics_engine_datasets` is `[]` in the adapter-merged config, there are no
`tail_consumers` (no tail worker), and the `SESSION` KV binding the adapter
injects is **never read by application code** — grep for `Astro.session` /
`context.session` returns nothing.

Also notable: **`docs/RUNBOOK.md` contains no `wrangler tail` procedure**, even
though observability is enabled. Triage today is entirely `gh run view`,
`wait-for-http.sh` and `yarn smoke` — that is, CI- and deploy-time. There is no
documented path for reading production behaviour at all. `docs/FEATURES.md`
frames the whole observability story around deploy verification ("*'Deployed'
means 'verified serving', not 'uploaded'*") and Discord alerting on pipeline
failure. **No document states a metrics or product-analytics expectation
anywhere.** This work would be the first.

**Nothing conflicts.** There is no analytics library to replace, no OTel
pipeline to reconcile, and no vendor script already loading.

**No Content-Security-Policy exists anywhere** — not in `wrangler.jsonc`, not in
`astro.config.mjs`, not as a `<meta>` tag, and `dist/client/_headers` contains
only an `_astro/*` immutable-cache rule. A third-party analytics script will not
be blocked. That is convenient now and worth revisiting later on its own merits.

**No consent banner, cookie notice, or privacy policy page exists.**

---

## 5. Identity

**All traffic is anonymous today. There is no stable user identifier, and no
cookie is set by application code.**

The full inventory of client-side persistence is one key:

| Mechanism | Value | What it identifies |
|---|---|---|
| `localStorage.theme` | `"dark"` / `"light"` | A **preference**, not a person |

No `Astro.cookies` writes, no `document.cookie`, no `Set-Cookie`, no
`sessionStorage`, no `crypto.randomUUID()`, no session KV reads. The only
`crypto` usage anywhere is `crypto.subtle.importKey` / `.sign` for HMAC token
signing. The `CF_Authorization` cookie exists on gated hostnames but is set by
Cloudflare Access, not by this app, and no app code ever reads a `CF-Access-*`
header.

**The site sets zero cookies today.** A PostHog browser install would introduce
the first cookie on `eddie.engineering` — on a site with no privacy policy to
point at, whose flagship feature is premised on *not* publishing contact
details. That is a product decision as much as a technical one.

Two identity-adjacent signals do exist server-side:

1. **`cf-connecting-ip`** — read in every rate limiter as `clientId`. An IP is
   personal data and a poor identifier (shared, rotating, and already known to
   be per-isolate unreliable for its current purpose).
2. **A verified email address, already available and currently discarded.**
   `verifyAccessCode()` in `src/util/air/requests.mjs` returns
   `{ok: true, email}` — the personal access code carries the address it was
   issued to, HMAC-signed, which is what lets it verify with no lookup. In
   `ask.ts` the result is destructured for `.ok` only; **the email is thrown
   away.**

That second one is the interesting finding for Phase 3. It is a real, verified,
consented-in-context identity that already crosses the wire on every A.I.R.
question, obtained with zero additional collection. It is also **a named person
Eddie personally approved**, which is exactly why using it as a `distinct_id`
deserves a deliberate decision rather than a default.

### Auth and gating

| Surface | Gate |
|---|---|
| A.I.R. chat | Build-time `PUBLIC_SHOW_AIR` **and** an access code — the shared card code, or a personal HMAC-signed code carrying an email. Fails closed if unset |
| Resume PDFs | `PUBLIC_SHOW_RESUME` + lead capture, returning 15-minute purpose-scoped download tokens |
| staging / previews | Cloudflare Access (Allow policy for Eddie, Service Auth for CI). As of 2026-07-29 `*-dev` has no policy — **previews are public** |
| production | Not gated — it is the public site |

---

## 6. PII and sensitive-data surface

Every place user-supplied text enters the system:

| Entry point | Fields | Where it goes | Stored? |
|---|---|---|---|
| `POST /api/air/ask` | `question` (free text, ≤500 chars) | Anthropic API | No |
| `POST /api/air/request` | `email`, `reason` (10–1000 chars) | Discord webhook + embedded in a signed 7-day token | **Nothing persisted** |
| `GET /api/air/approve` | `token` (query param, carries the email) | Renders HTML; sends email via the `EMAIL` binding | No |
| `POST /api/resume/request` | `email`, `reason`, `format` | Discord webhook + signed 15-min download tokens | **Nothing persisted** |
| `GET /api/resume/download` | `token` (carries email + format) | Watermarks the PDF with the email; **logs the email** | No, but logged |
| Access code header | `x-air-access` — a personal code **is** an encoded email | Verified in `ask.ts` | No |

Things to decide redaction for *before* instrumenting, not after:

1. **The `question` field.** Free text a stranger types about Eddie's career.
   Almost certainly the most useful single property for improving A.I.R., and
   the one most likely to contain something unexpected. Capturing it is a
   deliberate choice, not a default.
2. **Email addresses**, in four places: two request bodies, two token payloads,
   plus the personal access code itself.
3. **The `reason` free-text field**, twice. Someone explaining why they want
   Eddie's resume may name their employer, a role, or a hiring process.
4. **`cf-connecting-ip`**, currently used as a rate-limit key.
5. **Tokens.** `x-air-access`, approval tokens and download tokens are
   credentials. A personal access code is a signed email. **None of these may
   ever become an event property.**
6. **The `CONTACT` export** in `src/util/resume/resume.data.ts` — a real email
   address, imported by exactly one component (`PrintContact.astro`) used only
   on the two print routes. (It holds no phone number, by decision: "a number in
   a PDF travels with every forward of the file and cannot be un-shared.")

### The highest-risk finding: emails are decodable from query strings

Two GET routes carry a signed token in the URL, and **the token payload is
base64url, not encrypted** — it is trivially decodable:

| Route | Token payload | TTL |
|---|---|---|
| `GET /api/resume/download?token=…&format=…` | `{email, format, p:'download', t}` | 15 min |
| `GET /api/air/approve?token=…` | `{e: email, r: reason, t}` | 7 days |

The approval token therefore carries **both** a stranger's email and their
free-text reason, in a URL, for a week.

This is fine as designed — the signature is what provides integrity, and secrecy
of the payload was never the goal. It becomes a problem the moment an analytics
vendor is involved, because **PostHog's default browser autocapture sends
`$current_url`**. Three separate paths would exfiltrate these addresses:
default URL capture, referrer capture, and session replay. And the download URLs
are not merely visited — `ResumeDownload.tsx` renders them into the DOM as
visible `<a href>` fallback anchors, so a replay or DOM-scraping autocapture
picks them up even if nobody clicks.

Query strings on `/api/*` must be stripped before anything leaves the browser.
The codebase already treats these URLs as radioactive: `robots.txt.ts` puts
`/api/` in `ALWAYS_DISALLOWED` on every tier, commented precisely because "the
download endpoint in particular should never be fetched speculatively — it
consumes a signed, expiring token."

One more identity wrinkle: there are **three** email addresses in play across
this project — the published `connect@eddie.engineering`, and two others used as
git/account identities. Only the first is meant to be public. Any `identify`
call needs to be deliberate about which address it sends.

---

## 7. Tests and CI gates that will police this rollout

There are 15 vitest specs and 5 Playwright specs. Four existing guarantees bear
directly on instrumentation.

### A. A DOM-wide PII scan already covers injected scripts

`packages/web-astro-e2e/src/e2e/resume.spec.ts` — commented *"The premise of the
whole feature: the page publishes no way to contact him except the request
form."*

```js
const html = await page.content();
expect(html).not.toMatch(/mailto:/);
expect(html).not.toMatch(/[\w.-]+@[\w.-]+\.\w{2,}/);
expect(html).not.toMatch(/\+?\d{3}[\s.-]\d{3}[\s.-]\d{4}/);
```

This runs against the **fully rendered DOM** of `/air/resume/`, which includes
the content of any script tag we inject. So the no-contact-details guarantee is
*already partially enforced against analytics code* on that one page: a snippet
whose config or `identify` call contains an email-shaped string fails the build.

That is better than I expected, and it corrects the framing I would otherwise
have carried into Phase 3. But note the limits — it covers **one route**, and
only what is *in the document*, not what is *sent over the network*. A
`fetch()` to PostHog carrying an email in a JSON body passes this test cleanly.
So the asymmetry is narrower than feared but still real: **the redaction plan
still needs its own test, asserting on the outbound payload rather than the
DOM.**

### B. The no-public-PDF guarantee, enforced two ways

`resume.spec.ts` sweeps seven guessable PDF paths for 404s, then does the thing
that cannot be fooled: it recursively walks `dist/client` asserting no `.pdf`
extension **and** that no file begins with the `%PDF-` magic bytes. Commented:
*"Guessing paths can only find files someone thought to name… The second is the
one that cannot be fooled by a filename nobody predicted."*

Also locked in: print routes 404 in a normal build; a forged token is refused; a
token cannot fetch a format it was not issued for; replay inside the window is
**intended, not a bug**; and — the end-to-end proof — a served PDF must contain
the requester's address in its raw bytes.

### C. `RESUME` publishes no contact details

`src/util/resume/resume.data.spec.ts` asserts by pattern over every reachable
string that `RESUME` contains no email and no phone, and that `CONTACT` holds no
phone either. `src/util/resume/jsonld.spec.ts` asserts the JSON-LD `Person` has
no `email` and no `telephone` key, and gives locality/region but no street
address.

### D. Flags are strict opt-in

`src/util/visibility.spec.ts` asserts every `show*` helper is off unless the
value is the exact string `"true"`, and that `showHighlights` / `showFixtures`
are **not** implied by dev mode. Any new flag should inherit this discipline and
this spec.

### The gap in `check-bundle-secrets.mjs`

`scripts/check-bundle-secrets.mjs` runs in CI and before **both** deploys,
walking `dist` for credential shapes: `sk-ant-*`, `sk-(proj-)?[A-Za-z0-9]{32,}`,
`gh[pousr]_*`, `AKIA*`, `xox[abprs]-*`, private-key blocks, and
`CLOUDFLARE_API_TOKEN`.

**No PostHog key shape is in that pattern list.** PostHog's public project key
(`phc_…`) is designed to ship to browsers and is harmless. A *personal* API key
— which is what server-side local flag evaluation and the management API need —
is not, and today it would be silently inlined into the deployed Worker if it
happened to be present in the build environment. Adding a pattern for it is a
one-line change and belongs in the same PR as the first server-side key.

---

## 8. Constraints an instrumentation rollout must respect

Four traps, each already documented in the codebase:

1. **View transitions are on site-wide.** `<ClientRouter />` renders in
   `Layout.astro` on every page, so a plain `<script>` pageview fires once per
   hard load and **never on in-site navigation**. Bind to `astro:page-load`,
   which fires on first load and after every swap. The codebase already does
   this in `AnimateOnScroll.astro` and the resume expand script — and
   `ThemeIcon.astro` binds at module scope, which is a live example of the bug
   to avoid.
2. **Nx caches builds on a declared input list.** A new `PUBLIC_*` variable
   that is not added to `build.inputs` in `packages/web-astro/project.json`
   will be silently ignored on a cached build. This trap is called out verbatim
   in `scripts/resume-pdf.mjs`.
3. **The build strips server secrets from the environment.** `project.json`
   runs `env -u ANTHROPIC_API_KEY -u AIR_SIGNING_SECRET … astro build`, because
   Astro serialises the build machine's `process.env` into the server bundle and
   a live API key leaked that way once. A server-side ingest key must go through
   `readSecret()`, never `import.meta.env`.
4. **Preview Workers seed their own secrets.** `preview.yml` calls
   `wrangler secret put` per deploy. A runtime analytics secret not added to
   that block means **every preview silently has no analytics** — which is
   precisely the failure already documented in that step's comment for A.I.R.

Two useful gifts, already in place:

- **`PUBLIC_BUILD_SHA`** is stamped into `<meta name="build-sha">` on every
  page. A ready-made release identifier.
- **`tierFromRequest`** gives a correct environment label from the `Host`
  header. Note the documented quirk: under `wrangler dev` it reports
  `production`, because wrangler serves the Worker under the custom domain.

---

## 9. The existing feature-flag system

Flags are going to carry real weight in this design, so they get their own
inventory rather than a footnote.

### What exists

Eight flags, one helper each, all in `src/util/visibility.mjs`, all resolved
through `flagEnabled` which requires the **exact string `"true"`**:

| Helper | Env var | Read in |
|---|---|---|
| `showUnpublished` | `PUBLIC_SHOW_UNPUBLISHED` (dev implies on) | blog pages, `StarSpotlight`, `ask.ts` |
| `showAIR` | `PUBLIC_SHOW_AIR` | `/air/`, nav, all three `air` endpoints |
| `showBlog` | `PUBLIC_SHOW_BLOG` | `/blog/`, `/blog/<slug>/`, nav |
| `showProjects` | `PUBLIC_SHOW_PROJECTS` | `/works/`, `/projects/<slug>/`, nav |
| `showHighlights` | `PUBLIC_SHOW_HIGHLIGHTS` | `StarSpotlight` only |
| `showResume` | `PUBLIC_SHOW_RESUME` | resume pages, both resume endpoints |
| `showResumePrint` | `PUBLIC_RESUME_PRINT` | both print routes only |
| `showFixtures` | `PUBLIC_SHOW_FIXTURES` | `content.config.ts` (swaps the glob) |

There is dead code to avoid: `src/util/constants.ts` exports `showBlog`,
`showProjects`, `showAIR` read from **un-prefixed** `SHOW_BLOG` / `SHOW_PROJECTS`
/ `SHOW_AIR`. Vite never substitutes non-`PUBLIC_` names, so these are
permanently `undefined`. They are stale predecessors and nothing consumes them —
but they will show up in any grep for `SHOW_AIR`.

### These flags are a security boundary, not a visibility toggle

This is the part that constrains the design. The existing flags are **build-time**
— Vite substitutes them at compile time, so a flagged-off feature is not merely
hidden, its code path is gone and its endpoint returns 404. Three comments in the
codebase make the intent explicit:

- `ask.ts`: *"The section is gated, and so is its API. A flagged-off feature
  whose endpoint still answers is not gated, it is merely unlinked."*
- `visibility.mjs` on `showResumePrint`: the print routes are *"the same leak the
  gated PDFs are — the full resume, contact details included, in a **more**
  parseable form than a PDF."*
- `projects/[...slug].astro`: `getStaticPaths()` returns `[]` when the flag is
  off, so no HTML is even emitted.

A runtime flag cannot provide that property. A PostHog flag is fetched over the
network, can fail, can be stale, and is evaluated after the code has already
shipped. **Replacing any `PUBLIC_SHOW_*` gate with a PostHog flag would weaken a
deliberate security boundary**, and the honest recommendation is not to.

So the design should be **two layers, with a stated rule about which is which**:

| Layer | Mechanism | Answers | Failure mode |
|---|---|---|---|
| **Gate** | build-time `PUBLIC_SHOW_*`, unchanged | "does this feature exist on this tier?" | Fails closed, at build time |
| **Config / experiment** | PostHog flag, new | "how does this already-enabled feature behave?" | Must fall back to today's hardcoded default |

PostHog flags operate strictly *inside* a feature the build-time gate has already
turned on. That keeps the security property intact and still gets the A/B
capability.

### Where a runtime flag genuinely earns its place

`ask.ts` and the retrieval module are full of hardcoded constants that are
exactly the parameters you would want to vary without a redeploy:

| Constant | Location | Today |
|---|---|---|
| `MODEL` | `ask.ts` | `'claude-opus-5'` |
| `output_config.effort` | `ask.ts` | `'low'` |
| `MAX_TOKENS` | `ask.ts` | `2000` |
| `MAX_ENTRIES` | `retrieval.mjs` | `4` |
| `RELEVANCE_FLOOR` | `retrieval.mjs` | `3` |

Model choice is the headline case the request named, and it is a good one — a
single hardcoded string, one call site, and a bounded, reversible change.

### Four honest costs of an online model experiment

I would rather surface these now than have them discovered in Wave 3.

1. **Prompt caching is model-scoped, and this codebase deliberately optimises
   for it.** `SYSTEM_PROMPT` is a module-level constant specifically so it stays
   byte-identical across requests and caches. Splitting traffic across two models
   splits the cache into two entries with independent TTLs. On a low-traffic
   gated feature, an experiment could leave **neither arm** warm enough to hit
   cache — so the experiment itself changes the cost and latency it is measuring.
   Phase 3 needs to quantify this against the real request rate.

2. **Statistical power is probably not there.** A.I.R. is gated behind an access
   code handed out on a card, on a feature currently disabled in production. An
   online model A/B may never reach significance. That does not make the flag
   useless — as a **remote kill switch and config channel** it is valuable on day
   one — but Phase 2 should say plainly that PostHog experiments are not the
   right instrument for *"which model answers better"* at this traffic level.

3. **The offline eval harness is already the right instrument for that
   question.** `scripts/air-eval.mjs` sweeps `--models
   claude-opus-5,claude-sonnet-5,claude-haiku-4-5` over 14 golden cases in four
   categories, measures latency and tokens, prices them, and diffs against a
   saved baseline — weekly on cron. The two are complementary, not duplicative:
   **offline evals score guardrail adherence on fixed inputs; an online flag
   measures real questions.** `docs/AIR-SETUP.md` is already blunt that the eval
   score is not answer quality. Any online experiment must define a different
   metric than the harness does, or it is just a noisier rerun.

4. **There is no outcome metric to experiment against.** `AIResume.tsx` has no
   feedback affordance — no thumbs up/down, no "was this useful?", no copy
   action, no follow-up prompt. The only outcomes observable from the current
   code are machine-side: `grounded` true/false, verification failure, refusal,
   latency, tokens, cost. Those measure *whether the guardrails held*, not
   whether the answer was good — and a model that declines everything scores
   perfectly on them, which is the exact failure mode `docs/AIR-SETUP.md`
   already warns about for the offline harness. **A model experiment needs a
   human signal, and adding one is a UI change, not an instrumentation change.**
   That likely makes a small feedback control a prerequisite wave rather than a
   later nicety.

### Verified against PostHog's docs

Checked via the PostHog MCP on 2026-07-30, since this was the part I was least
willing to guess at.

**Local evaluation exists but fits this runtime badly.** It is available in the
Node SDK, and it requires a *feature flags secure API key* — secret, and
explicitly "must **not** be used in the frontend or exposed to users." That
lands it squarely in the §8 secret discipline: `readSecret()` only, and it must
be added to the `preview.yml` seeding block or previews silently lose flags.

More importantly, PostHog names this runtime as an anti-pattern outright:

> In edge/lambda environments and stateless PHP applications, local evaluation
> with the default in-memory cache causes performance issues and inflated costs
> due to per-request initialization. For these environments, use an external
> cache provider to share flag definitions across requests, or use regular flag
> evaluation instead.

Their guidance table lists *"Edge workers (Cloudflare, Vercel Edge) → Use KV
storage with split read/write pattern"*, via a `FlagDefinitionCacheProvider`
interface in `posthog-node`. Worth noting this repo already has KV plumbing to
copy — a `CF_SESSION_KV_ID` repo var, pinned per tier by
`make-worker-variant.mjs` — though the existing `SESSION` namespace should not
be repurposed for it.

**A correction to my own framing above.** Workers Free caps **CPU time** at
~10 ms, not wall-clock duration. An outbound `fetch` to PostHog's `/flags`
endpoint spends almost all its time waiting, which costs wall time rather than
CPU budget. So the real objection to remote evaluation is **added user-facing
latency on a request that already waits on a model**, not the CPU ceiling. That
distinction changes which option wins, so it was worth getting right.

**Which points at a simpler answer than either.** A model-selection flag has no
targeting — it resolves to the same value for every visitor — so per-user
evaluation is unnecessary work. Fetching the value once per isolate and caching
it in module scope with a short TTL gets remote-config behaviour with no
per-request network call and no secure API key, and it is the *same shape* as
the per-isolate rate limiter `access.mjs` already implements and documents.
Phase 3 will spell this out properly.

**Still unconfirmed:** whether the model name should ride a multivariate flag's
variant key or a JSON payload. The docs I read cover variants and rollout
hashing but I did not see the payload shape, so I am not going to assert a
signature for it. It is a Phase 3 detail, not a blocker.

---

## Drift from the committed docs

`docs/RESUME.md` lists under Known gaps: *"A.I.R. cannot answer resume
questions. Its corpus is `star` + `projects`."* That is **no longer true in the
working tree** — `ask.ts` now calls `getCollection('resume')` and maps entries
into the corpus with `resume/`-prefixed ids. The uncommitted resume work on
`feat/resume-under-air` closed that gap. Worth fixing in `RESUME.md` when this
branch lands, independently of observability.

---

## Open questions before Phase 2

**Answered 2026-07-30** — these five are settled and carried into Phase 2:

| # | Question | Answer |
|---|---|---|
| 1 | What should this serve? | **Debug staging + previews, with launch as the destination.** Ranking favours diagnostic questions over behavioural ones. |
| 3 | Redaction of `question` text | **Capture both question and answer.** Full traces. |
| 6 | Cloud vs self-hosted | **PostHog Cloud, US** — `us.posthog.com`, project `534721`, org "Simply Build". |
| 7 | Session replay | **No.** Aggregate metrics and LLM traces only. |
| 11–12 | Model flag | **Remote config / kill switch**, plus a **feedback control** to feed a model-and-prompt quality loop. Not a statistically-powered A/B. |

The rest are carried forward. Phase 2 proceeds with stated assumptions where an
answer is still outstanding — traffic volume (#4) in particular, which I have
assumed to be low.

These change what Phase 2 designs. The first three are the ones that would
corrupt everything downstream if I guessed.

1. **Given that production is three routes — what is the actual goal?** Three
   readings lead to very different designs:
   - *"Instrument now so data exists the day a flag flips"* → build the
     plumbing, expect near-zero volume for a while.
   - *"Measure staging and previews"* → the traffic is you and CI, so this is
     really debugging and eval tooling, not analytics.
   - *"This is a prompt to launch"* → then the sequencing question is which flag
     flips first, and instrumentation follows it.

2. **Is A.I.R. going to become publicly reachable, and on what horizon?** The
   deploy comment says it "is not ready to be found." Whether LLM tracing is
   Wave 1 or Wave 3 depends entirely on the answer.

3. **What is the redaction posture on the `question` field?** Full text, a
   length-and-shape summary, or nothing? Capturing questions is the highest-value
   LLM property and the highest-risk one. I will not assume either way.

4. **Roughly what monthly traffic should I plan for?** I have no analytics to
   read and production is one page. An order of magnitude is enough — hundreds,
   thousands, or tens of thousands of visits.

5. **Is the verified email from a personal access code acceptable as an
   identity key?** It is available, free, and genuinely identifying. It is also
   a named person you approved, and sending it to a third party is a different
   act from HMAC-signing it into a code.

6. **PostHog Cloud or self-hosted?** And if Cloud, US or EU region — relevant
   because the redaction decisions above interact with where data lands.

7. **Do you want session replay at all,** or aggregate metrics and traces only?
   Replay on a page with an email form and free-text fields carries real
   masking obligations.

8. **Any regulatory constraint I should know about?** There is no privacy policy
   or consent banner today, and visitors are likely to include EU-based
   recruiters.

9. **Workers Free CPU budget.** `docs/RESUME.md` notes this account is on
   Workers Free with ~10 ms CPU per request, which is why PDF watermarking is
   done by byte-patching rather than `pdf-lib`. Is added per-request work for
   telemetry acceptable within that budget, or must every send be
   fire-and-forget?

### On feature flags specifically

10. **Do PostHog flags stay strictly inside already-enabled features?** My
    recommendation is yes — keep every `PUBLIC_SHOW_*` gate exactly as it is,
    because build-time gating is a security property a runtime flag cannot
    replicate, and three code comments say so explicitly. Confirm you agree, or
    tell me which gate you want runtime-switchable and I will design the
    fallback carefully.

11. **For the model flag: experiment, or remote config?** These build
    differently and have different prerequisites.
    - *Remote config / kill switch* — swap `claude-opus-5` without a redeploy,
      roll back instantly if a model misbehaves. Works on day one, needs no
      traffic, low risk. I would ship this first regardless.
    - *A real A/B experiment* — needs a success metric, enough traffic for
      significance, and it fragments the prompt cache. Given A.I.R. is gated and
      currently off in production, I think this one is not yet worth
      instrumenting for, and I would rather say so than build it.

12. **Are you willing to add a feedback control to A.I.R.?** Without one there
    is no human outcome signal, so no model comparison can measure answer
    quality online — only whether the guardrails held. A single thumbs
    up/down next to an answer would unlock the whole experiment story. If you'd
    rather not touch the UI, say so and I will scope Phase 2 to machine-side
    metrics only.

13. **Which other constants should be flag-controlled?** `effort`,
    `MAX_TOKENS`, `MAX_ENTRIES`, `RELEVANCE_FLOOR` are all plausible. Each one
    added is another dimension that fragments the prompt cache and another thing
    that can drift from the eval harness's assumptions, so I would keep the
    initial set small — my instinct is `MODEL` and `effort` only.
