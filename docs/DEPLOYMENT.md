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
| `preview.yml` | PR opened/updated (skipped for docs-only changes) | verify → build → deploy a **per-PR dev Worker** on `<branch>-dev.eddie.engineering` → smoke test → comment the URL |
| `preview-cleanup.yml` | PR closed | delete that Worker, its Custom Domain and its KV namespace |
| `deploy.yml` | after CI succeeds on `master`, manual | **staging** (automatic) → *approval* → **production** |

## Environments

Three tiers, each its own Worker on its own hostname. The naming is
consistent across hostname, Worker, and GitHub environment:

| Tier | Hostname | Worker | GitHub environment | Deployed by |
|------|----------|--------|--------------------|-------------|
| **Production** | `eddie.engineering` | `eddies-portfolio` | `production` | `deploy.yml`, after approval |
| **Staging** (pre-prod) | `staging.eddie.engineering` | `eddies-portfolio-staging` | `staging` | `deploy.yml`, automatically on green `master` |
| **Dev** (per PR) | `<branch>-dev.eddie.engineering` | `eddies-portfolio-pr-<N>` | `development` | `preview.yml`, on every PR push |

> **Naming:** `-dev` is per-branch and ephemeral; `staging` is the single
> shared pre-production slot tracking `master`.

## Promotion flow

```
push to master
   └─ CI (check, lint, test, build)
        └─ deploy.yml
             ├─ staging   → staging.eddie.engineering   (automatic, smoke-tested)
             └─ production → eddie.engineering          (waits for approval)
```

Both stages live in **one workflow run**, so production only ever promotes a
commit that is already live and smoke-tested on staging.

When staging succeeds, Discord posts *"🧪 Staging deployed — ready to
promote"*. Its **Pipeline** link points at that same run, where the
production job is waiting — so the notification doubles as the promote
button.

### Enabling the approval gate

Without required reviewers, production deploys straight after staging. To
make it pause:

**Settings → Environments → `production` → Required reviewers** → add
yourself (a wait timer works too). GitHub then holds the production job until
it is approved from the run page.

**Why previews are separate Workers, not versions.** Cloudflare cannot serve
[preview URLs](https://developers.cloudflare.com/workers/configuration/previews/)
on a custom domain — they are limited to `workers.dev`. To get a real
`<branch>-staging` hostname, each PR deploys its own Worker with its own
Custom Domain, and `preview-cleanup.yml` tears it down when the PR closes.

`scripts/make-worker-variant.mjs` builds the preview and staging configs by
**replacing** `routes` (never appending), so a non-production tier can never
claim the production hostname even though it inherits the rest of the config.

### Optional variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PREVIEW_DOMAIN` | `eddie.engineering` | Zone that dev preview hostnames hang off |
| `STAGING_HOSTNAME` | `staging.eddie.engineering` | Staging hostname |
| `PRODUCTION_HOSTNAME` | `eddie.engineering` | Production hostname |
| `PREVIEW_DEPLOY_NOTIFY` | *(first only)* | `always` to ping Discord on every preview deploy, `never` to stay silent on preview successes. Failures always notify. |
| `CF_SESSION_KV_ID` | *(unset)* | Pin previews to one shared `SESSION` KV namespace instead of provisioning one per preview Worker |

## Production custom domain

`wrangler.jsonc` declares `eddie.engineering` as a Custom Domain, so
`wrangler deploy` claims it. A hostname binds to only one service, so it had
to be released by the old Cloudflare Pages project first — that cutover is
complete. If it ever needs redoing: remove the domain under
*Pages project → Custom domains*, then deploy the Worker.

## Access for preview hostnames

Dev previews live on `*-dev.eddie.engineering`, so the
Access application must cover the new pattern:

1. **Zero Trust → Access → Applications → Add → Self-hosted.**
2. **Domain:** `*-dev.eddie.engineering` (add `staging.eddie.engineering` too if staging should be gated).
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

- `/`, `/blog/`, `/works/`, a project page, a blog post and `/cv/air/` return 200
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
3. Add `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` as repo secrets
   (`gh secret set …`).

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

Secrets are **repo-level** (Repo → Settings → Secrets and variables →
Actions):

| Name | Purpose |
|------|---------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token — see permissions below |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID |
| `DISCORD_DEPLOY_WEBHOOK_URL` | Webhook for the **deployments** channel (success + URLs) |
| `DISCORD_ALERT_WEBHOOK_URL` | Webhook for the **alerts** channel (failures) |
| `CF_ACCESS_CLIENT_ID` | *(optional)* Access service token for smoke-testing gated previews |
| `CF_ACCESS_CLIENT_SECRET` | *(optional)* Access service token secret |

Jobs declare `environment:` for GitHub deployment tracking, the environment
URL, and the production approval gate — not for secret access:

| GitHub environment | Declared by |
|--------------------|-------------|
| `production` | `deploy.yml` production job (holds the approval gate) |
| `staging` | `deploy.yml` staging job |
| `development` | `preview.yml` per-PR deploys |

Environment-level secrets still **override** repo-level ones when set, so a
fork that wants per-environment credentials can add them without touching
the workflows.

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

## Discord alert routing

Two channels, mapped by event type:

- **Deployments channel** (`DISCORD_DEPLOY_WEBHOOK_URL`)
  - ✅ Preview deployed — **only the first success per PR**, since the preview
    URL is stable and later pushes would just repeat it. The PR comment is
    still updated on every deploy.
  - 🧪 Staging deployed — includes the staging URL, and its Pipeline link is
    the promote-to-production gate
  - 🚀 Production deployed — includes the production URL
- **Alerts channel** (`DISCORD_ALERT_WEBHOOK_URL`)
  - ❌ CI failed (check/lint/test/build)
  - ❌ Preview deploy failed
  - ❌ Staging deploy failed (production is not attempted)
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
./scripts/wait-for-http.sh <url>   # block until a host answers
```
