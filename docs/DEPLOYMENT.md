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
| `preview.yml` | PR opened/updated | `wrangler versions upload --preview-alias pr-<N>` → **private preview URL**, commented on the PR |
| `deploy.yml` | after CI succeeds on `master`, manual | `wrangler deploy` → **production** |

Preview uploads create a new Worker *version* without promoting it, so a PR
preview never affects production traffic.

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
```
