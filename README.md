# eddie.engineering

Eddie Freeman's portfolio — and the production pipeline behind it. An
[Astro 7](https://astro.build) site rendered on Cloudflare Workers, built in
an [Nx](https://nx.dev) monorepo, with tiered deployments, post-deploy smoke
tests, feature-flagged sections, and an interactive AI resume (A.I.R.).

Live at **[eddie.engineering](https://eddie.engineering)**.

## What's here

The site itself is a portfolio: about, blog, project case studies, and a
resume with a gated, watermarked PDF download. The engineering around it is
the larger half of the project:

- **Three deployment tiers** — production, staging, and a per-PR dev Worker on
  its own hostname, torn down when the PR closes.
- **Smoke-tested deploys** — "deployed" means _verified serving_, not
  "uploaded". Production promotes only a commit already live on staging.
- **Build-time feature flags** — unfinished sections 404 at the route, not
  just hide their nav link.
- **Scheduled publishing** — posts go live at a `publishDate` with no cron and
  no redeploy, because pages render per request.
- **Obsidian → blog pipeline** — notes convert to content-collection entries
  with links, embeds and frontmatter handled.
- **A.I.R.** — an access-coded chat that answers questions about Eddie's work,
  grounded in a STAR-story corpus, with its own eval suite.
- **Sealed content** — personal content (the real resume) is committed
  encrypted; builds without the key fall back to fixtures or 404.

Each of these exists to solve a specific problem, written up in
[docs/FEATURES.md](./docs/FEATURES.md). The decisions behind them — and the
thinking that produced the decisions — are indexed in
[docs/DECISIONS.md](./docs/DECISIONS.md).

## Quickstart

```bash
nvm use            # Node 22.12 (see .nvmrc)
yarn install
yarn astro:dev     # http://localhost:4321
```

Before pushing:

```bash
yarn ci            # check + lint + test + build — what CI runs
```

Useful day-to-day:

```bash
yarn test:watch          # Vitest in watch mode
yarn posts:queue         # what's live, scheduled, drafted
yarn smoke <url>         # assert a deployment actually serves
```

## Repository layout

| Package                          | What it is                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/web-astro`             | The site: Astro 7 + React 19 islands, Tailwind 4, Cloudflare Workers adapter            |
| `packages/web-astro-e2e`         | Playwright end-to-end suite, run against the built Worker                               |
| `packages/telemetry`             | Product/LLM telemetry primitives — dependency-free, vendor SDK injected by the consumer |
| `packages/obsidian-publish-core` | Obsidian note → content-collection conversion, pure and dependency-free                 |

## Documentation

[docs/README.md](./docs/README.md) is the index. The short version:

- **[FEATURES.md](./docs/FEATURES.md)** — what each capability does and which
  problem it solves
- **[DECISIONS.md](./docs/DECISIONS.md)** — the load-bearing decisions, each
  with its rationale and where the full story lives
- **[RUNBOOK.md](./docs/RUNBOOK.md)** — real failures this project hit, with
  symptom, cause, and fix
- **[CONTENT.md](./docs/CONTENT.md)** — writing and publishing workflows:
  posts, projects, STAR stories, sealed content
- **[DEPLOYMENT.md](./docs/DEPLOYMENT.md)** — environments, secrets, pipelines
- **[WORKFLOW.md](./docs/WORKFLOW.md)** — trunk-based git workflow

`CLAUDE.md` at the root covers codebase conventions for AI assistants.

## Using this as a template

Fork it — that's encouraged. The pipeline, the flags, the smoke tests, the
telemetry package and the Obsidian importer are all portable. What to change:

1. **Identity** — hostnames and Worker names in
   `packages/web-astro/wrangler.jsonc` and the workflow files; content in
   `packages/web-astro/src/content/`; `about.md`, images, and theme tokens in
   `src/styles/global.css`.
2. **Secrets** — every credential is yours to create:
   [DEPLOYMENT.md](./docs/DEPLOYMENT.md#required-github-secrets--variables)
   lists the GitHub/Cloudflare set, `docs/AIR-SETUP.md` the A.I.R. set.
3. **Personal docs** — `docs/VOICE.md` describes Eddie's writing voice and
   the sealed resume content is Eddie's; replace both with your own.

[docs/DECISIONS.md](./docs/DECISIONS.md) is the map of which choices were
context-specific (worth revisiting for your fork) versus structural (worth
keeping).

## Contributing

Issues and PRs are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). The
short version: branch from `master`, rebase (never merge master in), and
leave `yarn ci` green.

## Support

If this project helped you, whether a runbook entry saved your afternoon or
the pipeline became your template, you can support the work:

- **Ko-fi:** [ko-fi.com/pixelknitter](https://ko-fi.com/pixelknitter)
- **GitHub Sponsors:** via the Sponsor button on this repo

## License

[MIT](./LICENSE) — the code and pipeline are free to reuse. Site content
(posts, images, resume) is © Eddie Freeman and not covered by the code
license.
