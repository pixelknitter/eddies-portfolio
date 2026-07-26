# Features

What each capability is, and the problem it exists to solve. If a feature
here stops earning its keep, delete it.

---

## Tiered environments

**Problem.** Changes were verified by looking at them locally and hoping. There
was nowhere to review a change as it would actually behave — same runtime,
same edge, same rendering — before it reached visitors.

**Solution.** Three tiers, each its own Cloudflare Worker on its own hostname:

| Tier | Hostname | Lifetime |
|------|----------|----------|
| Production | `eddie.engineering` | permanent |
| Staging | `staging.eddie.engineering` | tracks `master` |
| Dev | `<branch>-dev.eddie.engineering` | one PR |

Separate Workers rather than one Worker with several routes, so a lower tier
**cannot** take production traffic even if its config is wrong.
`scripts/make-worker-variant.mjs` enforces that by *replacing* the `routes`
array rather than appending to it.

**What it buys.** Review a branch at a real URL. Catch an edge-only bug —
something that works in `astro dev` but not on Workers — before merging.

**Cost.** A Worker per open PR, cleaned up on close by `preview-cleanup.yml`.

---

## Post-deploy smoke tests

**Problem.** A deploy reporting success only means the upload succeeded. Twice
in this project a "successful" deploy served a site that was completely
broken: once every route 404'd (wrong deploy target), once the Worker failed
to boot (an incompatible image service).

**Solution.** `scripts/smoke-test.mjs` probes the freshly deployed URL and
asserts real behaviour — core routes return 200, the home page *contains its
rendered content*, unknown routes 404. The success notification and PR comment
only fire if it passes.

**Why "contains content" matters.** A status check alone is not enough.
Cloudflare Access answers unauthenticated requests with a login page that
returns **HTTP 200** — a naive check passes against a site it never reached.
The script detects that interstitial explicitly and authenticates with a
service token when one is configured.

**What it buys.** "Deployed" means "verified serving", not "uploaded".

---

## Gated promotion to production

**Problem.** Every push to `master` went straight to the live site. There was
no moment to look at the change on real infrastructure before visitors did.

**Solution.** `deploy.yml` runs staging and production as two jobs in **one**
run. Staging deploys automatically and is smoke-tested; production declares
`needs: staging` and waits on the `production` environment's required
reviewers.

The Discord "staging deployed" message links to that same run — where
production is paused — so the notification doubles as the promote button.

**What it buys.** Production only ever receives a commit already live and
verified on staging, promoted deliberately.

---

## Scheduled publishing

**Problem.** Publishing meant being at a keyboard at the right moment. Posts
either went out immediately or waited on the author remembering.

**Solution.** An optional `publishDate` on a post. It stays hidden until that
moment, then goes live on its own — the site renders per request, so the check
runs on every visit. No cron, no rebuild, no deploy.

```yaml
publishDate: 2026-08-01T09:00:00Z
```

`yarn posts:queue` shows what's live, scheduled, and drafted.

**What it buys.** Queue posts weeks ahead and forget them.

**Cost.** Post pages are SSR rather than prerendered — required, because a
prerendered page would exist on disk and be reachable by direct URL regardless
of its date. On Workers the difference is negligible.

---

## Obsidian → blog pipeline

**Problem.** Drafting happens in Obsidian, which speaks wikilinks, embeds and
callouts. Publishing meant translating all of that by hand, and hand-editing
is where broken links and missing images come from.

**Solution.** `scripts/obsidian-import.mjs` converts a note into a blog entry:
rewrites embeds and links, maps frontmatter to the collection schema, and
copies attachments out of the vault.

Two deliberate behaviours:

- **Links to unpublished notes degrade to plain text** rather than emitting a
  link that would 404 for every reader. A dead link is worse than no link.
- **Inline `#tags` become tags, but the word stays in the prose.** Code fences,
  headings and hex colours are left alone.

Imports default to `draft: true` — publishing stays a decision.

**What it buys.** Write where writing is comfortable; publish without a
translation step that silently loses things.

---

## Latest Work from GitHub

**Problem.** A portfolio that lists only finished case studies goes stale
between them, and shows nothing of what's actually being worked on.

**Solution.** A Content Layer loader fetches recently-pushed public repos **at
build time** and bakes them into the page.

**Why build time.** No runtime API call, no token in the Worker, no rate limit
exposure, and a GitHub outage cannot affect the live site. Failures are
non-fatal by design: an unreachable API logs a warning, yields an empty
collection, and the section simply doesn't render — a deploy is never broken
by a third party being down.

**Cost.** As fresh as the last deploy.

---

## STAR highlights

**Problem.** Career highlights either bloat the About section or go unwritten.

**Solution.** A `star` collection with typed Situation/Task/Action/Result
frontmatter. One published entry is chosen per request, so the spotlight
rotates on every visit. The section hides entirely when nothing is published.

**What it buys.** Add highlights over time; the home page stays short and
changes between visits.

**Gating.** `PUBLIC_SHOW_HIGHLIGHTS` — off by default, on in the review
tiers. Draft filtering used to hide the section by accident (every entry
happened to be a draft), which meant publishing one story would have put it
live with nothing holding it back. `_template.md` is excluded from the
collection by the loader's `[!_]` glob, so the rotation can never land on the
placeholder.

---

## Feature flags

**Problem.** Unfinished sections were reachable in production. Gating the nav
link is not enough: an unlisted page is still a public page if it responds,
and `/works/` was serving the placeholder Project 1–4 fixtures to anyone with
the URL.

**Solution.** Four opt-in build-time flags, each requiring the exact string
`"true"` (env vars arrive as strings, so a loose check would treat `"false"`
as enabled):

| Flag | Gates |
|------|-------|
| `PUBLIC_SHOW_BLOG` | `/blog/` and every post route |
| `PUBLIC_SHOW_PROJECTS` | `/works/` and the prerendered `/projects/*` pages |
| `PUBLIC_SHOW_AIR` | `/air/` |
| `PUBLIC_SHOW_HIGHLIGHTS` | the STAR spotlight on the home page |
| `PUBLIC_SHOW_UNPUBLISHED` | drafts and not-yet-due posts within an enabled section |

Each flag gates the **route**, not just the link. `/projects/*` is
prerendered and so cannot 404 at request time — its gate emits no paths at
all, keeping the pages off disk.

**What it buys.** Production shows only finished work, while staging and
per-PR previews show everything for review. The production smoke test asserts
both directions: gated routes must 404 and must not be linked.

---

## Discord deploy notifications

**Problem.** Knowing whether a deploy worked meant opening GitHub.

**Solution.** Two channels: **deployments** for successes with result URLs,
**alerts** for failures. Every message links to the pipeline run.

Preview successes announce **once per PR** — the URL is stable, so repeat
pings carry no information. Failures always notify. `PREVIEW_DEPLOY_NOTIFY`
(`always` / `never`) overrides.

**What it buys.** Deploy state where you already are, without noise.
