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
| `preview.yml` | PR opened/updated | verify → build → `wrangler versions upload --preview-alias pr-<N>` → **smoke test** → comment the URL on the PR |
| `deploy.yml` | after CI succeeds on `master`, manual | verify → build → `wrangler deploy` → **smoke test** |

Preview uploads create a new Worker *version* without promoting it, so a PR
preview never affects production traffic.

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

## First-time setup: bootstrap the Worker

`preview.yml` uses `wrangler versions upload`, which **requires the Worker to
already exist**. On a brand-new account/worker it fails with:

```
✘ [ERROR] You cannot upload a new version of a Worker that does not yet
  exist. Please run the `deploy` command first.
```

So the Worker must be created once, by a production deploy. Either:

**A. Locally (one command, no token needed):**
```bash
npx wrangler login                 # interactive OAuth
yarn nx build web-astro
npx wrangler deploy -c packages/web-astro/dist/server/wrangler.json
```

**B. Or merge to `master`** — CI passes, `deploy.yml` runs `wrangler deploy`,
and the Worker is created. Every PR opened *after* that gets a preview.

Once the Worker exists, previews work on every PR and this step never
repeats.

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

`Workers Scripts: Edit` covers `wrangler deploy` and `versions upload`;
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

## Private previews with Cloudflare Access

Each PR gets a stable aliased preview URL:

```
https://pr-<N>-eddies-portfolio.<your-subdomain>.workers.dev
```

Workers has **built-in Access integration for preview URLs**, which is the
simplest way to keep them private:

1. **Workers & Pages dashboard → your Worker → Settings → Domains & Routes.**
2. Under **Preview URLs**, click **Enable Cloudflare Access**.
3. Add the emails allowed to view previews. Everyone else gets the Access
   login screen.

This gates *preview URLs only* — your production URL and any custom domain
stay public.

> **Migrating from the old Pages setup:** the previous Access application
> targeting `*.eddies-portfolio.pages.dev` no longer matches anything, since
> previews are now `*.workers.dev`. Remove it (or leave it, harmless) and use
> the Preview URLs toggle above instead.

Reference: [Workers preview URLs](https://developers.cloudflare.com/workers/configuration/previews/).

## Local commands

```bash
yarn ci            # check + lint + test + build (what CI runs)
yarn astro:build   # production build -> packages/web-astro/dist
yarn smoke <url>   # smoke test a deployed URL
```
