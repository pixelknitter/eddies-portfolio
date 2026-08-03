# Documentation

Organized by what you're trying to do.

**Understand the project**

| Document                       | Read it when                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------- |
| [FEATURES.md](./FEATURES.md)   | You want to know _what_ a capability does and _which problem_ it solves      |
| [DECISIONS.md](./DECISIONS.md) | You want the load-bearing decisions in one place — especially before forking |

**Operate — the two runbooks**

| Document                   | Read it when                                                         |
| -------------------------- | -------------------------------------------------------------------- |
| [RUNBOOK.md](./RUNBOOK.md) | Something is broken, or you're changing infrastructure               |
| [CONTENT.md](./CONTENT.md) | You're writing or publishing: posts, projects, STAR stories, sealing |

**Set up & reference**

| Document                               | Read it when                                                             |
| -------------------------------------- | ------------------------------------------------------------------------ |
| [CONTENT-MODEL.md](./CONTENT-MODEL.md) | You need a content field's shape, or what A.I.R. can retrieve            |
| [DEPLOYMENT.md](./DEPLOYMENT.md)       | You need the environment/deploy reference: hostnames, secrets, pipelines |
| [ACCESS.md](./ACCESS.md)               | You're setting up or debugging Cloudflare Access on the gated tiers      |
| [AIR-SETUP.md](./AIR-SETUP.md)         | One-time setup for A.I.R.: secrets, DNS, Discord webhook, evals          |
| [RESUME.md](./RESUME.md)               | You're touching the resume: content model, sealing, PDFs, watermarking   |

**Working here**

| Document                     | Read it when                                         |
| ---------------------------- | ---------------------------------------------------- |
| [WORKFLOW.md](./WORKFLOW.md) | You're branching, updating a branch, or landing a PR |
| [VOICE.md](./VOICE.md)       | You're writing or editing a post                     |

`CLAUDE.md` at the repo root covers codebase structure and conventions for
AI assistants. [CONTRIBUTING.md](../CONTRIBUTING.md) is the front door for
external contributors.

## Decision docs vs. process docs

The files above record **what stands** — current behaviour and the decisions
behind it. Two directories preserve **how the thinking unfolded**, and are
kept deliberately, unrevised:

- [`observability/`](./observability/) — a four-phase arc (inventory →
  questions → design → rollout) that produced the telemetry decisions
- [`superpowers/`](./superpowers/) — design specs and plans for individual
  features, written before implementation

If a decision doc says _what_, these say _why it beat the alternatives_.
When they disagree, the decision docs win — process docs are a snapshot of
their date.

## Quick reference

```bash
yarn ci                  # check + lint + test + build (what CI runs)
yarn posts:queue         # what's live, scheduled, drafted
yarn smoke <url>         # assert a deployment actually serves
```

| Tier         | Hostname                         |
| ------------ | -------------------------------- |
| Production   | `eddie.engineering`              |
| Staging      | `staging.eddie.engineering`      |
| Dev (per PR) | `<branch>-dev.eddie.engineering` |
