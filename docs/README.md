# Documentation

| Document | Read it when |
|----------|--------------|
| [FEATURES.md](./FEATURES.md) | You want to know *what* a capability does and *which problem* it solves |
| `AIR-SETUP.md` | One-time setup for A.I.R.: email DNS, secrets, Discord webhook |
| [RUNBOOK.md](./RUNBOOK.md) | Something is broken or you're about to change infrastructure |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | You need the environment/deploy reference: hostnames, secrets, Access |
| [WORKFLOW.md](./WORKFLOW.md) | You're branching, updating a branch, or landing a PR |
| [VOICE.md](./VOICE.md) | You're writing or editing a post |
| [research/](./research/) | Background on a decision that's already been made |

`CLAUDE.md` at the repo root covers codebase structure and conventions for
AI assistants.

## Quick reference

```bash
yarn ci                  # check + lint + test + build (what CI runs)
yarn posts:queue         # what's live, scheduled, drafted
yarn smoke <url>         # assert a deployment actually serves
```

| Tier | Hostname |
|------|----------|
| Production | `eddie.engineering` |
| Staging | `staging.eddie.engineering` |
| Dev (per PR) | `<branch>-dev.eddie.engineering` |
