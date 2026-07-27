# A.I.R. go-live checklist

Everything that has to be configured outside the codebase before A.I.R. works
in production. Nothing here is in the repo — these are secrets, DNS, and a
Discord webhook.

**Do step 1 first.** It is the only step with a wait attached — everything
else takes about ten minutes. `eddie.engineering` already lives on Cloudflare,
so the DNS records are added for you rather than needing a trip to a registrar.

---

## 1. Email sending for `eddie.engineering`

Approval emails are sent from `connect@eddie.engineering`, so that domain has to be
onboarded to Cloudflare Email Sending before anything will send.

```bash
cd packages/web-astro
npx wrangler email sending enable eddie.engineering
```

`eddie.engineering` is already a Cloudflare zone — it is where the site is
served from — so the SPF and DKIM records are added automatically. There is
nothing to copy into a registrar.

The sending records are TXT only. They do not touch the A/CNAME records the
Worker's custom domain uses, so this cannot disturb the live site.

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
