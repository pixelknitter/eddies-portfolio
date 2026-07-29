# A.I.R. setup

Everything that lives outside the codebase: secrets, DNS, a Discord webhook.

## 0. Point wrangler at the right account

`eddie.engineering` is in `Eddie@ninjasudo.com's Account`. Wrong account gives a
misleading error — *"Could not find a zone"* when it's looking in the other one.

`wrangler login` stores **one** credential, so it logs you out of other projects.
Use a scoped token instead; `CLOUDFLARE_API_TOKEN` takes precedence over the
stored login.

```bash
brew install direnv                     # + eval "$(direnv hook zsh)" in ~/.zshrc
mkdir -p ~/.config/cloudflare && chmod 600 ~/.config/cloudflare/*
cp .envrc.example .envrc && direnv allow
```

Token scopes (My Profile → API Tokens → Create Custom Token): Workers Scripts
**Edit**, Workers KV **Edit**, Email Sending **Edit**, Zone DNS **Edit**, Zone
**Read**, Account Settings **Read**.

> `wrangler whoami` reports the stored login even when a token is in use.
> `env | grep CLOUDFLARE` is the honest check.

## 1. Secrets

Per Worker — production and staging share nothing. Use a **different**
`AIR_ACCESS_CODE` and `AIR_SIGNING_SECRET` on staging.

```bash
cd packages/web-astro
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put AIR_ACCESS_CODE             # the code on the card
npx wrangler secret put AIR_SIGNING_SECRET          # openssl rand -base64 32
npx wrangler secret put DISCORD_ACCESS_WEBHOOK_URL  # its own channel
# repeat with --name eddies-portfolio-staging
```

| Secret | Missing means |
|---|---|
| `ANTHROPIC_API_KEY` | Asking returns 503 |
| `AIR_ACCESS_CODE` | **Everyone locked out** — the gate fails closed |
| `AIR_SIGNING_SECRET` | Requests 503; personal codes stop verifying |
| `DISCORD_ACCESS_WEBHOOK_URL` | Requests 503 |

Secrets apply immediately; no redeploy. GitHub Actions needs `ANTHROPIC_API_KEY`
for the eval workflow — and nothing else, since runtime secrets must never reach
a build step.

## 2. Your STAR stories

Drop markdown into `packages/web-astro/src/content/star/`, same frontmatter as
`sample-platform-migration.md`. `draft: false` makes a story answerable.

Until a real story lands, A.I.R. honestly declines the three suggested
questions. Two evals are skipped while the corpus is placeholder and arm
themselves once one arrives — a suggested question with nothing behind it then
fails the build.

## 3. Email (optional, needs Workers Paid)

Cloudflare Email Sending requires the paid plan; on Free the API returns
`Unauthorized [code: 2036]` regardless of token scopes. **A.I.R. works without
it** — approving shows the code on the page and you pass it on, which at a
conference beats asking someone to check their inbox.

If you upgrade: `npx wrangler email sending enable eddie.engineering`. The zone
is already on Cloudflare, so SPF/DKIM are added for you (TXT only — it cannot
disturb the site). A third-party sender is *more* work: same DNS, plus a code
change.

## 4. Verify

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://eddie.engineering/air/
curl -s -X POST https://eddie.engineering/api/air/ask \
  -H 'content-type: application/json' -H 'x-air-access: YOUR_CODE' \
  -d '{"question":"Why should I work with Eddie Freeman?"}'
```

Then run the request → Discord → approve → code flow with your own address.

## Comparing models

```bash
node scripts/air-eval.mjs --models claude-opus-5,claude-sonnet-5,claude-haiku-4-5
```

Or **Actions → A.I.R. evals**, which also runs weekly.

Read per category, never as a total: it scores guardrail adherence, not answer
quality, so a model that declines everything aces `boundary` and `security` and
fails `grounding`. The *where the models disagree* section is the only part that
tells you a switch would change behaviour.

## Day-of

- No code? They hit *"Ask Eddie for access"*; you approve from Discord.
- Approval link clicked twice: harmless, re-sends the same code.
- Email didn't arrive: the approval page shows the code — read it out.
- Revoke everything: rotate `AIR_SIGNING_SECRET`.

Failure modes with causes and fixes: `RUNBOOK.md`. Status codes are diagnostic —
`401` wrong/unset code, `429` rate limited, `503` gate passed but a secret is
missing, `200` + `grounded: false` working correctly with a gap in the corpus.
