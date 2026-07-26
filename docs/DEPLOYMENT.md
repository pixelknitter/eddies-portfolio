# Deployment & CI/CD

This repo deploys the `web-astro` app to **Cloudflare Workers** and runs three
GitHub Actions pipelines. Preview deployments are private, gated by
**Cloudflare Access**.

> **Workers, not Pages.** `@astrojs/cloudflare` dropped Cloudflare Pages
> support, so the adapter emits a Worker. The build produces
> `packages/web-astro/dist/client` (static assets) and
> `packages/web-astro/dist/server` (the Worker entry plus a generated
> `wrangler.json`). Deploying that tree with `wrangler pages deploy` produces
> a site that 404s on every route — use `wrangler deploy`.

## Pipelines

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | push to `master`, any PR, manual | `check` → `lint` → `test` → `build` |
| `preview.yml` | PR opened/updated | verify → build → deploy a **per-PR Worker** on `<branch>-staging.eddie.engineering` → **smoke test** → comment the URL |
| `preview-cleanup.yml` | PR closed | delete that Worker, its Custom Domain and its KV namespace |
| `deploy.yml` | after CI succeeds on `master`, manual | verify → build → `wrangler deploy` → **smoke test** |

## Domain model

| Environment | Hostname | Service |
|-------------|----------|---------|
| Production | `eddie.engineering` | Worker `eddies-portfolio` |
| Preview (per PR) | `<branch>-staging.eddie.engineering` | Worker `eddies-portfolio-pr-<N>` |

**Why previews are separate Workers, not versions.** Cloudflare cannot serve
[preview URLs](https://developers.cloudflare.com/workers/configuration/previews/)
on a custom domain — they are limited to `workers.dev`. To get a real
`<branch>-staging` hostname, each PR deploys its own Worker with its own
Custom Domain, and `preview-cleanup.yml` tears it down when the PR closes.

`scripts/make-preview-wrangler.mjs` builds the preview config by **replacing**
`routes` (never appending), so a preview can never claim the production
hostname even though it inherits the rest of the config.

### Optional variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PREVIEW_DOMAIN` | `eddie.engineering` | Zone that preview hostnames hang off |
| `CF_SESSION_KV_ID` | *(unset)* | Pin previews to one shared `SESSION` KV namespace instead of provisioning one per preview Worker |

## ⚠️ Production cutover checklist (one time)

`wrangler.jsonc` declares `eddie.engineering` as a Custom Domain. **A hostname
can only be bound to one service**, so it must be released by Cloudflare Pages
*before* the first Workers deploy carrying that config — otherwise the deploy
fails with the hostname already in use.

Do this in order:

1. **Pages → `eddies-portfolio` → Custom domains** — remove `eddie.engineering`
   (and `staging.eddie.engineering`, now served by per-PR previews).
2. **Merge the upgrade PR.** `deploy.yml` runs `wrangler deploy`, which claims
   `eddie.engineering` for the Worker and issues its certificate.
3. **Verify** — the deploy's smoke test asserts the live site; the Discord
   deployments channel carries the URL.
4. Optionally delete the now-unused Pages project.

Rolling back means reversing step 1: detach from the Worker, re-attach to
Pages. Expect a brief window while DNS and certificates settle.

## Access for preview hostnames

Previews now live on `*-staging.eddie.engineering`, not `*.pages.dev`, so the
Access application must cover the new pattern:

1. **Zero Trust → Access → Applications → Add → Self-hosted.**
2. **Domain:** `*-staging.eddie.engineering`.
3. **Policies:** an *Allow* policy for the people who may review, plus a
   *Service Auth* policy including the CI service token so smoke tests can
   authenticate.
4. Leave `eddie.engineering` itself **outside** any Access policy so the
   public site stays public.

## Testing gates

Deployments are guarded on both sides:

**Before deploying** — `preview.yml` and `deploy.yml` both run the full
`check` / `lint` / `test` suite at the deployed commit, so a preview is never
published from a tree that would have failed CI.

**After deploying** — `scripts/smoke-test.mjs` probes the freshly deployed URL
and asserts real behaviour:

- `/`, `/blog/`, `/works/`, a project page, a blog post and `/air/` return 200
- the home page actually contains its rendered content, not just any 200
- an unknown route returns 404
- the response is not the Cloudflare Access login page

That last check matters: Access answers unauthenticated requests with a login
page that returns **HTTP 200**, so a naive status check would pass against a
site it never reached.

Run it locally against any deployment:

```bash
yarn smoke https://your-deployment-url
```

### Smoke-testing gated previews

Previews sit behind Access, so CI needs an **Access service token** to reach
them. Without one the script reports that the deployment is gated and skips
its assertions (it does not silently pass).

To enable real preview validation:

1. **Zero Trust → Access → Service Auth → Create Service Token.** Copy the
   Client ID and Client Secret.
2. Add the token to the Access policy protecting your previews (a policy with
   action **Service Auth** including that token).
3. Add `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` to the `staging`
   environment secrets.

Production is public, so it is always fully asserted.

## Worker configuration

`packages/web-astro/wrangler.jsonc` holds the base config (worker name,
compatibility date, `workers_dev`). At build time the Astro adapter merges it
with the generated entry point, the `ASSETS` binding pointing at
`../client`, and the `SESSION` KV binding, writing the result to
`packages/web-astro/dist/server/wrangler.json` — which is what both workflows
pass to `wrangler -c`.

Wrangler provisions the `SESSION` KV namespace automatically on first deploy;
no manual setup required.

## Required GitHub secrets & variables

Secrets are stored as **environment secrets** (not repo-level) under
**Repo → Settings → Environments**. Two environments are used:

| Environment | Used by | Jobs |
|-------------|---------|------|
| `staging` | `preview.yml`, `ci.yml` (alert job) | Per-PR preview deploys + CI failure alerts |
| `production` | `deploy.yml` | Production deploys |

Each environment holds the same four secrets:

| Name | Purpose |
|------|---------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token — see permissions below |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `DISCORD_DEPLOY_WEBHOOK_URL` | Webhook for the **deployments** channel (success + URLs) |
| `DISCORD_ALERT_WEBHOOK_URL` | Webhook for the **alerts** channel (failures) |
| `CF_ACCESS_CLIENT_ID` | *(optional, `staging`)* Access service token for smoke-testing previews |
| `CF_ACCESS_CLIENT_SECRET` | *(optional, `staging`)* Access service token secret |

> **Why jobs declare `environment:`** — environment secrets are only readable
> by a job that names its environment. That's why `preview.yml` declares
> `staging`, `deploy.yml` declares `production`, and the CI **alert** job
> (failure-only, so green runs don't create deployment records) declares
> `staging`.

> If a Discord webhook secret is not set, the notification step **no-ops**
> (it never fails the pipeline).

### API token permissions

Create a **custom token** scoped to your account only (these are
**Account**-level permissions, not Zone — searching for them under a
"Specified Domains" scope will not find them):

| Scope | Permission | Level |
|-------|------------|-------|
| Account | **Workers Scripts** | Edit |
| Account | **Workers KV Storage** | Edit |

`Workers Scripts: Edit` covers `wrangler deploy` for both production and previews;
`Workers KV Storage: Edit` lets Wrangler provision the `SESSION` namespace.
The worker name is set in `wrangler.jsonc`, so no project-name variable is
needed.

### Environment protection (optional)
Because `deploy.yml` now targets the `production` environment, you can add
**required reviewers** or a **wait timer** under
*Settings → Environments → production* to gate production releases. No
protection rules are configured today.

## Discord alert routing

Two channels, mapped by event type:

- **Deployments channel** (`DISCORD_DEPLOY_WEBHOOK_URL`)
  - ✅ Preview deployed (per PR) — includes the preview URL
  - 🚀 Production deployed — includes the production URL
- **Alerts channel** (`DISCORD_ALERT_WEBHOOK_URL`)
  - ❌ CI failed (check/lint/test/build)
  - ❌ Preview deploy failed
  - ❌ Production deploy failed

Every notification links back to the **pipeline run**; deployment
notifications also carry the **result URL**. The embed color encodes status
(green = success, red = failure). Routing lives in the workflows via the
`./.github/actions/discord-notify` composite action — add or move steps there
to change what each channel receives (e.g. to also ping deployments on CI
success).

### Creating the webhooks
In Discord: **Channel → Edit → Integrations → Webhooks → New Webhook →
Copy URL**. Create one in your deployments channel and one in your alerts
channel, then store them as the two secrets above.

## Local commands

```bash
yarn ci            # check + lint + test + build (what CI runs)
yarn astro:build   # production build -> packages/web-astro/dist
yarn smoke <url>   # smoke test a deployed URL
```
