# A.I.R. go-live checklist

Everything that has to be configured outside the codebase before A.I.R. works
in production. Nothing here is in the repo — these are secrets, DNS, and a
Discord webhook.

**Do step 1 first.** It is the only step with a wait attached — everything
else takes about ten minutes. `eddie.engineering` already lives on Cloudflare,
so the DNS records are added for you rather than needing a trip to a registrar.

---

## 0. Point wrangler at the right account

You have more than one Cloudflare account, and `eddie.engineering` lives in
`Eddie@ninjasudo.com's Account` — not the `yourcurlfriend.com` one. Getting
this wrong produces errors that blame the wrong thing: wrangler reports
*"Could not find a zone for eddie.engineering"* when the real problem is that
it is looking in a different account.

`wrangler login` is the wrong tool for this, because it stores **one**
credential — logging in here logs you out of whatever your other projects use,
and wrangler keeps resolving the previous account id for a while afterwards.

Use a scoped API token per project instead. `CLOUDFLARE_API_TOKEN` takes
precedence over the stored login, so nothing gets clobbered:

```bash
# once, per machine
brew install direnv          # then add `eval "$(direnv hook zsh)"` to ~/.zshrc

mkdir -p ~/.config/cloudflare
pbpaste > ~/.config/cloudflare/eddies-portfolio.token   # paste the token first
chmod 600 ~/.config/cloudflare/eddies-portfolio.token

# in the repo
cp .envrc.example .envrc
direnv allow
```

Create the token at **My Profile → API Tokens → Create Custom Token** with:

| Scope | Why |
|---|---|
| Account → Workers Scripts: **Edit** | Deploys |
| Account → Workers KV Storage: **Edit** | The adapter's session KV |
| Account → Email Sending: **Edit** | Approval emails |
| Zone → DNS: **Edit** (`eddie.engineering`) | SPF/DKIM records for sending |
| Zone → Zone: **Read** (`eddie.engineering`) | Zone lookup |
| Account → Account Settings: **Read** | Account resolution |

That is considerably narrower than an OAuth login, which carries write access
to roughly twenty product areas including `cloudchamber` and
`connectivity:admin`.

> **`wrangler whoami` lies here.** It reports the stored OAuth login even when
> a token in the environment is what is actually being used. The honest check
> is `env | grep CLOUDFLARE`.

---

## 1. Email sending for `eddie.engineering`

Approval emails are sent from `connect@eddie.engineering`, so that domain has to be
onboarded to Cloudflare Email Sending before anything will send.

> ## This step is optional, and costs $5/month
>
> **Cloudflare Email Sending requires the Workers Paid plan.** On Free the API
> returns `Unauthorized [code: 2036]` no matter how the token is scoped — it is
> a plan gate, not a permissions problem, and no amount of token fiddling gets
> past it.
>
> **A.I.R. works fully without it.** Approving shows the code on the page and
> you pass it on yourself. For a conference that is arguably the better flow:
> handing someone a code while they are standing in front of you beats asking
> them to check their inbox. Email matters for people who request access from
> the site *after* the event.
>
> If you do want email, upgrade at **Workers & Pages → Plans → Paid**, then
> continue below. Note that switching to a third-party sender instead (Resend,
> Postmark) is *more* work, not less — it needs the same DNS verification plus
> a code change, where the Cloudflare binding is already wired.

Then, from a shell logged into the right account:

```bash
cd packages/web-astro

# wrangler resolves a stale account id after switching logins, so pin it.
# Without this it looks for the zone in the wrong account and reports
# "Could not find a zone for eddie.engineering" — which is misleading.
export CLOUDFLARE_ACCOUNT_ID=631de303454b0687e7a2aeee17d3d65f

npx wrangler email sending enable eddie.engineering
```

> **Check which account you are in first.** `npx wrangler whoami` should show
> `Eddie@ninjasudo.com's Account`. That is the one holding `eddie.engineering`,
> `simply.build` and `wanderinghearth.studio` — not the `yourcurlfriend.com`
> account.

`eddie.engineering` is a zone in that account, so the SPF and DKIM records are
added for you. They are TXT records only and do not touch the A/CNAME records
the Worker's custom domain serves the site from.

**If Email Sending is not available to the account**, A.I.R. still works — the
approval page shows the code inline whenever the email binding is missing or a
send fails, so you can read it to someone or paste it into a message. The card
code path is unaffected. Email is a convenience here, not a dependency.

Confirm it landed:

```bash
npx wrangler email sending list
```

`eddie.engineering` should appear as enabled. If it shows pending, give the
records a few minutes to propagate — usually quick on an existing Cloudflare
zone, but it is still the one thing here you wait on.

> **You do not need a mailbox at `connect@eddie.engineering`.** Sending and
> receiving are separate. Replies will bounce unless you also set up Email
> Routing for that address — worth doing, since the approval email invites
> people to reply.

---

## 2. Discord webhook

A.I.R. access requests should go somewhere you will actually notice — its own
channel, not the existing deploy or alert channels.

1. Create a channel (something like `#air-requests`).
2. **Channel settings → Integrations → Webhooks → New Webhook.**
3. Copy the webhook URL. You will paste it in the next step.

---

## 3. Secrets

Four secrets, and they are **per Worker** — production and staging are separate
Workers and do not share anything.

Generate the signing secret first:

```bash
openssl rand -base64 32
```

Then set all four on production:

```bash
cd packages/web-astro

npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put AIR_ACCESS_CODE            # the code you put on the card
npx wrangler secret put AIR_SIGNING_SECRET         # the openssl output above
npx wrangler secret put DISCORD_ACCESS_WEBHOOK_URL # from step 2
```

And again for staging, adding `--name`:

```bash
npx wrangler secret put ANTHROPIC_API_KEY --name eddies-portfolio-staging
npx wrangler secret put AIR_ACCESS_CODE --name eddies-portfolio-staging
npx wrangler secret put AIR_SIGNING_SECRET --name eddies-portfolio-staging
npx wrangler secret put DISCORD_ACCESS_WEBHOOK_URL --name eddies-portfolio-staging
```

Use a **different** `AIR_ACCESS_CODE` and `AIR_SIGNING_SECRET` on staging. A
code that works on both means a staging leak is a production leak.

| Secret | What it does | If it is missing |
|---|---|---|
| `ANTHROPIC_API_KEY` | Pays for answers | Asking returns 503 |
| `AIR_ACCESS_CODE` | The shared code on the card | **Everyone is locked out** — the gate fails closed on purpose |
| `AIR_SIGNING_SECRET` | Signs approval links and issued codes | Requests return 503; personal codes stop verifying |
| `DISCORD_ACCESS_WEBHOOK_URL` | Where requests land | Requests return 503 |

Secrets take effect immediately. **No redeploy needed.**

---

## 4. Your STAR stories

This is the one that changes what the demo actually shows.

Drop your refined stories into `packages/web-astro/src/content/star/` as
markdown, one per file, using the same frontmatter as
`sample-platform-migration.md`:

```yaml
---
title: 'Short, concrete title'
situation: >-
  The context you walked into.
task: >-
  What you specifically were responsible for.
action: >-
  What you actually did — decisions and trade-offs.
result: >-
  The outcome, with a number wherever you have one.
tags: ['infrastructure', 'leadership']
draft: false
---
```

`draft: false` is what makes a story answerable in production.

**Until a real story lands, A.I.R. will honestly decline the three suggested
questions** — because nothing in the corpus answers them. Two evals are skipped
while the corpus is placeholder and arm themselves the moment you add a real
story; if a suggested question has nothing behind it, the build fails rather
than letting you find out on stage.

---

## 5. Verify before you travel

```bash
# The page is live
curl -s -o /dev/null -w '%{http_code}\n' https://eddie.engineering/air/

# The gate is closed to strangers
curl -s -X POST https://eddie.engineering/api/air/ask \
  -H 'content-type: application/json' \
  -d '{"question":"Why work with Eddie?"}'
# → 401 "This resume is available by invitation."

# Your code opens it
curl -s -X POST https://eddie.engineering/api/air/ask \
  -H 'content-type: application/json' \
  -H 'x-air-access: YOUR_CODE' \
  -d '{"question":"Why should I work with Eddie Freeman?"}'
```

Then do the request flow end to end **with your own address**, so you see what
a stranger sees: submit the form on `/air/`, check Discord, click approve,
confirm the email arrives and its code works.

Do this once before the conference. It is the only way to find out that DNS
was not quite done.

---

## Comparing models

The live eval suite runs the golden set against several models and reports
them side by side:

```bash
ANTHROPIC_API_KEY=... node scripts/air-eval.mjs \
  --models claude-opus-5,claude-sonnet-5,claude-haiku-4-5 \
  --report report.md
```

In CI it is **Actions → A.I.R. evals → Run workflow**, which also runs weekly
so model drift surfaces on its own. The table lands on the run summary and as
a downloadable artifact.

**Read the report per category, never as a total.** It scores guardrail
adherence, not answer quality — a model that declines every question aces
`boundary` and `security` and fails only `grounding`. A blended number would
rank that model first. Read the first two as "stays inside the lines", the
third as "still useful", and use latency and cost to choose between models
that hold both.

The *Where the models disagree* section is the part worth reading closely: it
is the only place a model switch would actually change behaviour.

---

## Day-of quick reference

- **Someone wants access** → they use the card code, or hit *"Ask Eddie for
  access"* and you approve from Discord on your phone.
- **Approval link clicked twice** → harmless. It re-sends the same code to the
  same address; it cannot grant anything new.
- **Email did not arrive** → the approval page shows the code inline. Read it
  to them.
- **Revoke everything** → rotate `AIR_SIGNING_SECRET`. Every emailed code stops
  working immediately. The card code is separate — rotate `AIR_ACCESS_CODE` for
  that.

---

## When something is wrong

`docs/RUNBOOK.md` has the failure modes with causes and fixes — 401 for
everyone, 503 on asking, 503 on requesting, approval emails not sending, and
the build-time secret leak that `scripts/check-bundle-secrets.mjs` guards.

The status codes are diagnostic on their own, because the endpoint checks
things in order:

| Response | What it tells you |
|---|---|
| `401` | The code is wrong or `AIR_ACCESS_CODE` is unset |
| `429` | Rate limited — 8 questions per minute |
| `503` | The gate passed; a secret is missing |
| `200` with `grounded: false` | Everything works. The corpus just does not cover that question |
