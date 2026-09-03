# Tinkershop: a shared foundation for several sites

> **Status:** design, pending review
> **Date:** 2026-09-02
> **Supersedes:** nothing. First architecture doc covering more than one site.

## The problem

`eddies-portfolio` holds one site. Four more are planned — whimsicalfruit.life,
eddie.games, liminal.living, and whatever the newly registered domains become —
and two existing businesses (Simply Build, Your Curlfriend) already duplicate
parts of what this repo does. The duplication runs both ways: YCF has charting
components this repo wants, and this repo has a content pipeline YCF wants.

Nothing here is broken. The cost is that every improvement lands in one place
and has to be re-made in the others by hand.

## Goals

1. One improvement to a shared thing reaches every site that uses it, without
   hand-copying.
2. Simply Build / YCF can consume that shared thing from their own private
   repos.
3. The shared foundation is legible enough to stand as a portfolio artifact.
4. A solo operator can maintain all of it.

## Non-goals

- **Not** a general-purpose framework for other people. It is published so that
  private repos can install it, and it is public because nothing in it needs to
  be secret. No support promise, no roadmap, no issue triage.
- **Not** mobile. React Native is aspirational; see "Keeping mobile cheap".
- **Not** a migration of YCF onto Nx. See "What Turborepo changes".
- **Not** a rewrite. Every phase leaves the site working.

## Decisions

### Repo name: `tinkershop`

`eddies-portfolio` stops being accurate the moment it holds four sites and the
packages beneath them. `tinkershop` covers both the tools and the work, and
ages as the contents change.

Rename cost, to schedule rather than discover: the GitHub rename (old URLs
redirect, but local remotes should be updated), Cloudflare Worker and project
names, any CI badge, and README links.

### npm scope: `@tink`

Short, and it locates a package without explanation — `@tink/tokens` is
obviously from this repo. Consolidating settles the existing split between
`@pk/telemetry` and `@eddie/obsidian-publish-core`. Both are unpublished, so the
rename is free now and expensive after the first publish.

**Verify the scope is actually claimable before relying on it.** Zero published
packages under a scope does not prove it is unclaimed; an org can exist with
nothing public. Confirm with `npm org create tink`.

### Public monorepo, published packages

The repo is public and stays public. Everything requiring privacy is *content*,
and the sealed vault already solves that — 51 blobs, decrypted at build time
with a CI secret.

Apps inside the monorepo resolve packages through the workspace. External
private consumers (Simply Build, YCF) install the published artifact.

This makes change amplification deliberately asymmetric:

| consumer | mechanism | cost of a shared change |
|---|---|---|
| the four sites | workspace resolution | one commit, one CI run |
| Simply Build / YCF | published `@tink/*` | version bump, Renovate PR, their CI |

That is the correct coupling, not a compromise. A business platform should not
churn every time a card's padding is nudged.

### Three kinds of sharing

Conflating these is the usual mistake, and each wants different machinery.

| kind | contents | mechanism |
|---|---|---|
| **Packages** | tokens, UI, charts, content pipeline, telemetry | published `@tink/*` |
| **Docs** | deployment practices, agentic lessons, conventions | `docs/`, read by humans |
| **Scaffolding** | app structure | a generator, not a dependency |

App structure is a *starting point*, not a runtime dependency. Shipping it as a
package produces a framework nobody wants to fight; shipping it as a generator
produces a directory you own from the first commit.

## Package boundaries

Ordered by how much they impose on a consumer, which is also the extraction
order.

| package | depends on | imposes on a consumer |
|---|---|---|
| `@tink/tokens` | nothing | nothing — a CSS file and a JS object |
| `@tink/telemetry` | nothing (exists) | a vendor adapter it injects |
| `@tink/obsidian-publish-core` | nothing (exists) | nothing |
| `@tink/charts` | React | React, and agreement about tokens |
| `@tink/astro-ui` | Astro, Tailwind 4 | Astro, Tailwind 4, the `.dark` convention |
| `@tink/content-core` | Astro content layer | the whole content model |

**Tokens go first, and not because they are easiest.** They are the only piece
that travels without conditions: a plain CSS file plus a JS object, adoptable by
YCF whether or not it uses Astro, Tailwind, or any component convention.

That asymmetry is also the honest test of this whole plan. If tokens cannot be
adopted by YCF cleanly, nothing heavier will be — and it is far better to learn
that after one small package than after four large ones.

## The reconciliation problem

Phase 2 is not an extraction. YCF has charts and rings this repo wants, and some
pieces exist in both. Each component needs a source-of-truth decision, and the
losing implementation needs its call sites migrated.

**Expect phase 2 to take longer than phase 3 despite being smaller.** It is
named here so that is a plan and not a surprise.

## What Turborepo changes

YCF runs Turborepo with pnpm workspaces; tinkershop runs Nx with Yarn 3.

- **Phases 1–4: no effect.** A published package is tooling-agnostic.
- **Phase 5 forks.** "Share the app structure" cannot mean "share Nx config."
  The generator emits a tool-neutral skeleton — src layout, content config,
  deploy script, README — and the ~20 lines of `nx.json` / `turbo.json` stay
  hand-written per repo.
- **Do not migrate tinkershop to Turborepo.** Nx's affected-graph drives the
  deploy gating, it works, and switching buys only a generator that emits
  config either way.
- The Yarn/pnpm mismatch is irrelevant for consuming published packages. It
  would only matter for a single workspace spanning both repos, which this
  design avoids.

## Keeping mobile cheap

React Native is aspirational, so this design does not pay for it up front. It
buys the option cheaply by holding one line: **tokens and pure logic stay
platform-neutral; components may be web-only.**

That is the same discipline that already makes `@pk/telemetry` run unchanged in
workerd, Node, and the browser. Holding it costs nothing now and avoids a
rewrite if mobile ever happens.

## Phasing

Each phase leaves the site working and is independently abandonable.

### Phase 0 — Naming and READMEs

Rename the repo, consolidate the npm scope, layer the READMEs (root explains the
monorepo; each package explains itself).

*Done when:* the repo is `tinkershop`, both existing packages are `@tink/*`,
`yarn ci` is green, and the site deploys.

### Phase 1 — `@tink/tokens`, published

Extract the `@theme` block and its JS mirror. Publish. Consume it back in
web-astro. Then install it in YCF.

*Done when:* web-astro renders identically from the package, YCF has it
installed and using at least one token, and the publish is repeatable from CI.

**This phase is the go/no-go for the rest.** If adoption in YCF is painful,
stop and reconsider before extracting anything heavier.

### Phase 2 — `@tink/charts` (reconciliation)

Bring YCF's charts and rings across. Decide a source of truth per component,
migrate the losing call sites.

*Done when:* one implementation of each component exists, both repos consume it,
and no call site references a local copy.

### Phase 3 — `@tink/astro-ui`

Layouts, `Card`, `Prose`, navigation, theme toggle. Depends on tokens existing.

*Done when:* web-astro imports these from the package and renders identically.

### Phase 4 — `@tink/content-core`

Collection schemas, `visibility.mjs`, the flags system, the seal tooling and its
guards.

*Done when:* web-astro's content pipeline runs from the package, all content
guards still fire, and the vault behaves unchanged.

### Phase 5 — Scaffolding generator + second site

Build the generator; use it to create whimsicalfruit.life. **The `apps/`
restructure happens here**, driven by a real second app rather than
speculatively.

*Done when:* `whimsicalfruit.life` deploys from the monorepo, per-app deploy
gating works, and the generator produced the skeleton.

### Phase 6 — Travel, and the Timeline extractor

A deterministic, local, private extractor producing country + month/year + city.
Lands on whimsicalfruit.

*Done when:* the extractor runs offline, its output is reviewable before it is
committed, and nothing derived from raw Timeline data enters the repo unfiltered.

## Risks

| risk | mitigation |
|---|---|
| The `apps/` restructure touches everything and stalls | Deferred to phase 5, behind a real second app |
| Semver becomes an obligation to YCF | Only tokens are published early; break it while the only consumer is you |
| Reconciliation drags | Named as the long pole; one component at a time |
| Timeline data carries home address and daily movement | Extractor is local and its output is reviewed before commit |
| Public repo publishes commit history for personal sites | Content stays sealed; the commit-message guard already exists |
| The npm scope turns out to be claimed | Verify in phase 0, before anything depends on the name |

## Open questions

1. Does YCF have a web frontend that would use `@tink/tokens`, or is phase 1's
   external consumer hypothetical? If hypothetical, the go/no-go test in phase 1
   is weaker and the order may want revisiting.
2. Which domain becomes the blog — `liminal.living` or `eddieis.living`?
3. Do `eddie.diy` and `eddieis.me` get sites, or are they defensive
   registrations? Affects only how general the generator must be.
