# Deployment & CI/CD

This repo deploys the `web-astro` app to **Cloudflare Pages** and runs three
GitHub Actions pipelines. Preview deployments are private, gated by
**Cloudflare Access**.

## Pipelines

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | push to `master`, any PR, manual | `check` → `lint` → `test` → `build` |
| `preview.yml` | PR opened/updated | Build + deploy a **private per-PR preview**, comment the URL on the PR |
| `deploy.yml` | after CI succeeds on `master`, manual | Build + deploy **production** |

Build output is `packages/web-astro/dist` (see the note in the root
`CLAUDE.md` on why the output lives inside the package).

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
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with **Account → Cloudflare Pages → Edit** |
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

### Variables (optional)
| Name | Default | Purpose |
|------|---------|---------|
| `CLOUDFLARE_PROJECT_NAME` | `eddies-portfolio` | Cloudflare Pages project name |

Set this as an **environment variable** in both environments (or repo-level
if available); otherwise the workflows fall back to `eddies-portfolio`.

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

Each PR deploys to a per-branch preview alias
(`<branch>.<project>.pages.dev`). To keep previews private, put them behind
**Cloudflare Access (Zero Trust)**:

1. **Zero Trust dashboard → Access → Applications → Add an application →
   Self-hosted.**
2. **Application domain:** cover the preview hosts for the project. Add both:
   - `*.<project>.pages.dev` (per-branch/per-commit previews)
   - `<project>.pages.dev` (if you also want to gate the default subdomain)
   > Keep your **production custom domain** on a separate application (or no
   > Access policy) so the public site stays open.
3. **Policies:** add an **Allow** policy scoped to who may review — e.g.
   *Emails* = your address, or *Emails ending in* your domain. Everyone else
   gets the Access login screen.
4. Save. Reviewers now authenticate via Access before the preview loads.

Reference: Cloudflare Pages → “Customize preview deployments access” and
Cloudflare Zero Trust → Access docs.

## Local commands

```bash
yarn ci            # check + lint + test + build (what CI runs)
yarn astro:build   # production build -> packages/web-astro/dist
```
