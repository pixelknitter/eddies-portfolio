# Deployment & CI/CD

This repo deploys the `web-astro` app to **Cloudflare Pages** and runs three
GitHub Actions pipelines. Preview deployments are private, gated by
**Cloudflare Access**, and every deployment is smoke-tested before it is
reported as successful.

## Pipelines

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | push to `master`, any PR, manual | `check` → `lint` → `test` → `build` |
| `preview.yml` | PR opened/updated | verify → build → deploy a **private per-PR preview** → **smoke test** → comment the URL on the PR |
| `deploy.yml` | after CI succeeds on `master`, manual | verify → build → deploy **production** → **smoke test** |

Build output is `dist/packages/web-astro`.

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

## Required GitHub secrets & variables

Secrets are stored as **environment secrets** (not repo-level) under
**Repo → Settings → Environments**. Two environments are used:

| Environment | Used by | Jobs |
|-------------|---------|------|
| `staging` | `preview.yml`, `ci.yml` (alert job) | Per-PR preview deploys + CI failure alerts |
| `production` | `deploy.yml` | Production deploys |

| Name | Environment | Purpose |
|------|-------------|---------|
| `CLOUDFLARE_API_TOKEN` | both | Cloudflare API token — **Account → Cloudflare Pages → Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | both | Your Cloudflare account ID |
| `DISCORD_DEPLOY_WEBHOOK_URL` | both | Webhook for the **deployments** channel (success + URLs) |
| `DISCORD_ALERT_WEBHOOK_URL` | both | Webhook for the **alerts** channel (failures) |
| `CF_ACCESS_CLIENT_ID` | `staging` | *(optional)* Access service token for smoke-testing previews |
| `CF_ACCESS_CLIENT_SECRET` | `staging` | *(optional)* Access service token secret |

> **Why jobs declare `environment:`** — environment secrets are only readable
> by a job that names its environment. That's why `preview.yml` declares
> `staging`, `deploy.yml` declares `production`, and the CI **alert** job
> (failure-only, so green runs don't create deployment records) declares
> `staging`.

> If a Discord webhook secret is not set, the notification step **no-ops**
> (it never fails the pipeline).

### Variables (optional)
| Name | Default | Purpose |
|------|---------|---------|
| `CLOUDFLARE_PROJECT_NAME` | `eddies-portfolio` | Cloudflare Pages project name |

### Environment protection (optional)
Because `deploy.yml` targets the `production` environment, you can add
**required reviewers** or a **wait timer** under
*Settings → Environments → production* to gate production releases.

## Discord alert routing

Two channels, mapped by event type:

- **Deployments channel** (`DISCORD_DEPLOY_WEBHOOK_URL`)
  - ✅ Preview deployed (per PR) — includes the preview URL
  - 🚀 Production deployed — includes the production URL
- **Alerts channel** (`DISCORD_ALERT_WEBHOOK_URL`)
  - ❌ CI failed (check/lint/test/build)
  - ❌ Preview failed (verify, deploy, or smoke test)
  - ❌ Production deploy failed (verify, deploy, or smoke test)

Every notification links back to the **pipeline run**; deployment
notifications also carry the **result URL**. The embed color encodes status
(green = success, red = failure).

### Creating the webhooks
In Discord: **Channel → Edit → Integrations → Webhooks → New Webhook →
Copy URL**. Create one in your deployments channel and one in your alerts
channel, then store them as the two secrets above.

## Private previews with Cloudflare Access

Each PR deploys to a per-PR preview alias (`pr-<N>.<project>.pages.dev`). To
keep previews private:

1. **Zero Trust dashboard → Access → Applications → Add an application →
   Self-hosted.**
2. **Application domain:** `*.<project>.pages.dev` to cover per-branch and
   per-commit previews.
   > Keep your **production custom domain** on a separate application (or no
   > Access policy) so the public site stays open.
3. **Policies:** add an **Allow** policy scoped to who may review — e.g.
   *Emails* = your address, or *Emails ending in* your domain.
4. Optionally add the **Service Auth** policy described above so CI can smoke
   test previews.

## Local commands

```bash
yarn ci                        # check + lint + test + build (what CI runs)
yarn astro:build               # production build -> dist/packages/web-astro
yarn smoke <url>               # smoke test a deployed URL
```
