# Contributing

Thanks for looking at this. Issues, fixes, and improvements to the pipeline
or the docs are all welcome. If you're forking the whole thing as a template
instead, see [Using this as a template](./README.md#using-this-as-a-template)
— no permission needed, it's MIT.

## Before you start

- **Open an issue first for anything non-trivial.** This is a personal site,
  so some choices (content, voice, visual design) aren't open for change —
  an issue avoids you building something that can't land.
- **Good targets:** runbook additions, pipeline hardening, accessibility
  fixes, test coverage, doc corrections, and bugs you actually hit.

## Setup

```bash
nvm use          # Node 22.12
yarn install
yarn astro:dev   # http://localhost:4321
```

Some content is sealed (encrypted at rest) and needs a key you won't have.
Everything still builds without it: resume routes render fixtures when
`PUBLIC_SHOW_FIXTURES=true`, or 404 otherwise. See `docs/RESUME.md`. You
never need the key to work on the pipeline, components, or docs.

## Making a change

1. Branch from `master`: `type/short-description` (`feat/`, `fix/`, `ci/`,
   `docs/`, `test/`, `content/`).
2. Keep the branch to one logical change. Unrelated work is a separate PR.
3. Update the branch by **rebasing** onto `master` — never merge `master` in.
   The full workflow, including why, is [docs/WORKFLOW.md](./docs/WORKFLOW.md).
4. Leave `yarn ci` green (`check` + `lint` + `test` + `build`).
5. Commit messages: imperative subject, then the _why_ in the body.

PRs get a private preview deployment on a real Workers hostname; CI comments
the URL on the PR. Maintainer review is required to merge.

## Conventions

Code conventions live in [CLAUDE.md](./CLAUDE.md) — written for AI
assistants, but it's the same rulebook for humans: path aliases, typed props,
Astro components by default with React islands only where interactivity
demands it, and both themes tested for every visual change.
