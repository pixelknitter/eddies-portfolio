# Decisions

The load-bearing decisions in this project, each stated once, with its
rationale and a pointer to the full write-up. If you're forking this as a
template, this is the map of what to keep and what to revisit.

**How this relates to the rest of the docs.** Two layers exist on purpose:

- **Decision docs** record what stands and why: this file,
  [FEATURES.md](./FEATURES.md) (per-capability problem → solution),
  [DEPLOYMENT.md](./DEPLOYMENT.md), [RESUME.md](./RESUME.md).
- **Process docs** preserve how the thinking unfolded — the questions asked,
  the options weighed, the answers that came back differently than expected:
  [`observability/`](./observability/) (a four-phase inventory → questions →
  design → rollout arc) and [`superpowers/`](./superpowers/) (design specs
  and plans for individual features).

Read a decision doc to act; read a process doc to understand — or challenge —
how a decision was reached.

Decisions marked **(context-specific)** follow from this site's particular
situation and deserve a fresh look in a fork. Everything else is structural:
it guards against a failure mode that will exist in your fork too.

---

## Deployment

- **Cloudflare Workers, not Pages.** `@astrojs/cloudflare` dropped Pages
  support; deploying its output to Pages "succeeds" and serves nothing.
  → [DEPLOYMENT.md](./DEPLOYMENT.md), [RUNBOOK.md](./RUNBOOK.md#every-route-404s-after-a-successful-deploy)
- **A separate Worker per tier, with `routes` replaced rather than
  appended.** A lower tier then _cannot_ claim the production hostname, even
  with a broken config. → [FEATURES.md](./FEATURES.md#tiered-environments)
- **Staging and production deploy in one workflow run, with an approval gate
  between them.** Production only ever promotes a commit already live and
  smoke-tested on staging. → [FEATURES.md](./FEATURES.md#gated-promotion-to-production)
- **Smoke tests assert behaviour, not status codes.** Cloudflare Access
  answers unauthenticated requests with an HTTP 200 login page, so a naive
  check passes against a site it never reached; the script detects the
  interstitial and checks rendered content. → [FEATURES.md](./FEATURES.md#post-deploy-smoke-tests)
- **Deploys wait for the served `build-sha` to match the built commit.** The
  edge briefly serves the previous Worker version after `wrangler deploy`
  returns, and the old version answers 200 perfectly well.
  → [RUNBOOK.md](./RUNBOOK.md#smoke-test-fails-on-flags-the-code-clearly-gates)
- **Runtime secrets never appear in a build step's environment.** Astro
  serialises the build machine's entire `process.env` into the server bundle;
  `check-bundle-secrets.mjs` enforces this after every build.
  → [RUNBOOK.md](./RUNBOOK.md#a-secret-ended-up-in-the-built-worker)

## Content & publishing

- **Feature flags gate the route, not the link, and require the exact string
  `"true"`.** An unlisted page is still a public page if it responds, and env
  vars arrive as strings — a loose check treats `"false"` as enabled.
  → [FEATURES.md](./FEATURES.md#feature-flags)
- **Post pages are SSR so scheduled publishing needs no cron and no
  redeploy.** A prerendered page exists on disk and is reachable by direct
  URL regardless of its publish date. → [FEATURES.md](./FEATURES.md#scheduled-publishing)
- **GitHub activity is fetched at build time, never at request time.** No
  token in the Worker, no rate-limit exposure, and a GitHub outage cannot
  break a deploy — failures yield an empty section, not an error.
  → [FEATURES.md](./FEATURES.md#latest-work-from-github)
- **Obsidian links to unpublished notes degrade to plain text.** A link that
  404s for every reader is worse than no link. → [FEATURES.md](./FEATURES.md#obsidian--blog-pipeline)
- **Sealed content is enforced-not-deleted, and deliberately not
  gitignored.** The plaintext working copy stays editable; hooks and CI
  refuse to commit it. A gitignore would have to name the files, leaking
  exactly what the opaque blob names hide.
  → [CONTENT.md](./CONTENT.md#working-on-sealed-content), [RESUME.md](./RESUME.md#sealing-and-fixtures)
- **A build that loses the seal key fails visibly (404) rather than shipping
  fixtures as if they were real.** A hollow resume with a JSON-LD graph
  asserting a person with no work history is worse than an outage.
  → [RESUME.md](./RESUME.md#sealing-and-fixtures)
- **`challenges` is its own collection, not a flag on `star`.** `star` feeds
  the home-page spotlight, so a boolean guarding a candid account of failure
  would be one forgotten default away from publishing it as a headline.
  → [CONTENT-MODEL.md](./CONTENT-MODEL.md#the-collections-at-a-glance)
- **A.I.R. retrieval scores frontmatter only, and `tags` carries the asker's
  vocabulary.** Bodies reach the model but never make an entry findable, so
  tags hold role and practice terms, not just the stack.
  → [CONTENT-MODEL.md](./CONTENT-MODEL.md#what-air-actually-retrieves)

## Resume & A.I.R.

- **The resume and A.I.R. have separate flags** _(context-specific)_. The
  resume is built to be found (JSON-LD, robots.txt); A.I.R. is held back
  until it's ready to be found. One flag would couple their launches.
  → [RESUME.md](./RESUME.md#why-the-resume-has-its-own-flag)
- **The PDFs are compiled into the Worker bundle, not served from
  `public/`.** Static assets are served before the Worker runs, at guessable
  URLs — a gated download whose bytes also sit at `/resume.pdf` is not gated.
  → [RESUME.md](./RESUME.md#why-the-pdfs-are-in-the-worker-bundle)
- **The PDF fingerprint hashes inputs, not output.** Chrome stamps a
  creation date and trailer ID into every print, so output bytes are not
  reproducible. → [RESUME.md](./RESUME.md#regenerating-the-pdfs)
- **Watermarking is fixed-offset byte substitution, prepared at generation
  time** _(constraint-driven)_. Workers Free allows ~10 ms CPU per request;
  re-saving a PDF through `pdf-lib` is not available at any price. And it is
  attribution, not prevention — the real protection is that no PDF exists at
  a public URL. → [RESUME.md](./RESUME.md#watermarking-and-why-it-looks-the-way-it-does)
- **Download tokens are purpose-scoped, in both the signature and a claim.**
  One secret signs two unrelated grants; the claim stops a future refactor
  from silently re-opening cross-purpose replay. → [RESUME.md](./RESUME.md#secrets)

## Observability

- **Wave 1 was LLM tracing, not pageviews** _(context-specific)_. Production
  is currently three routes; a pageview install would measure a one-page
  site, while "which failure was it?" is answerable at n=1 today. The full
  reasoning — including why this inverts the standard advice — is the
  process arc in [`observability/`](./observability/).
- **No session replay; 30-day retention; alerts reuse Discord.**
  → [`observability/03-design.md`](./observability/03-design.md)
- **Telemetry is a dependency-free package; the vendor SDK is injected by
  the consumer, never imported.** The same redaction code must run in
  workerd, Node, and the browser without divergence.
  → [`superpowers/specs/`](./superpowers/specs/), `packages/telemetry`

## Workflow

- **Trunk-based development; branches rebase onto `master`, never merge it
  in.** Beyond linear history: `pull_request` workflows run the workflow
  file from the PR's own branch, so only a rebase picks up pipeline fixes.
  → [WORKFLOW.md](./WORKFLOW.md)
