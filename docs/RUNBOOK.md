# Runbook

Operational procedures and known failure modes. **Every entry below is a
failure this project actually hit**, with the symptom that appeared, the real
cause, and the fix — not hypotheticals.

Reference for hostnames, secrets and Access setup: [DEPLOYMENT.md](./DEPLOYMENT.md).

---

## Triage: a deploy went red

Work in this order — it costs a minute and avoids chasing the wrong thing.

1. **Which step failed?** `gh run view <id>` — a failure in *deploy* is
   infrastructure; a failure in *smoke test* is the app or a race.
2. **Is it reproducible?** Hit the URL yourself. If it's healthy now, it was a
   propagation race, not a regression.
   ```bash
   ./scripts/wait-for-http.sh https://<host>
   yarn smoke https://<host>
   ```
3. **Is it only one tier?** Production green but staging red points at
   hostname or binding, not code.
4. **Did the same commit pass elsewhere?** A PR preview that passed and a
   staging deploy that failed on the same commit is environmental.

---

## Known failure modes

### "Some triggers failed to deploy" / `domains/records` API error

**Symptom.** The *Deploy* step fails. The error mentions
`/workers/scripts/<name>/domains/records`.

**Cause.** The hostname is still bound to another service. **A hostname can
only attach to one service.** This happens when a domain is left on the old
Cloudflare Pages project.

**Fix.** Cloudflare dashboard → **Workers & Pages** → the **Pages** project
(the entry with the GitHub badge, *not* the Worker of the same name) →
**Custom domains** → remove the hostname. Then re-run the deploy.

> Two entries share the name `eddies-portfolio` — one Pages project, one
> Worker. Custom domains live on the Pages one.

---

### Every route 404s after a "successful" deploy

**Cause.** Deployed with `wrangler pages deploy`. `@astrojs/cloudflare` no
longer supports Pages — it emits a Worker (`dist/client` + `dist/server`).
Pushing that tree to Pages uploads the two directories as plain folders, so
nothing serves `/`.

**Fix.** Use `wrangler deploy -c packages/web-astro/dist/server/wrangler.json`.

---

### The Worker deploys but fails to boot

**Symptom.** Routes 500. Locally, `wrangler dev` errors with
`Could not resolve "child_process"` or `"fs"`.

**Cause.** The default **Sharp** image service isn't Cloudflare-compatible and
pulls Node built-ins into the bundle.

**Fix.** `imageService: 'passthrough'` in the adapter options.

---

### Some routes 500 right after deploy, healthy minutes later

**Cause.** Propagation. The entry Worker answers before its assets are fully
available, so asset-backed and prerendered routes error briefly.

**Fix.** Already handled: `wait-for-http.sh` probes several routes and requires
all non-5xx; `smoke-test.mjs` retries 5xx (4xx stays definitive so an expected
404 isn't retried into a timeout). If it still trips, raise the attempt count.

---

### A secret ended up in the built Worker

**Cause.** Astro serialises the build machine's whole `process.env` into the
server bundle, so anything exported during `astro build` ships inside the
Worker. Not fixable via Vite `define` — the inlining is a wholesale object
assignment, not a replaceable reference.

**Fix.** Keep the build environment clean. Runtime secrets belong in Cloudflare
(`wrangler secret put`) or `.dev.vars` locally — never a workflow's build-step
`env:`. `scripts/check-bundle-secrets.mjs` runs after every build and before
every deploy. If a key did ship, **rotate it first** — the bundle is public.

---

### A.I.R. returns an error

The endpoint checks cheap things first, so the status says where it stopped.

| Status | Cause | Fix |
|---|---|---|
| `401` | `AIR_ACCESS_CODE` wrong or unset — the gate fails closed | `wrangler secret put AIR_ACCESS_CODE` |
| `429` | Rate limited (8/min ask, 3/10min request) | Wait |
| `503` on ask | `ANTHROPIC_API_KEY` unset. Gate and retrieval passed | `wrangler secret put ANTHROPIC_API_KEY` |
| `503` on request | `AIR_SIGNING_SECRET` or `DISCORD_ACCESS_WEBHOOK_URL` unset | Set both |
| `200` + `grounded: false` | Working. The corpus doesn't cover the question | Add a STAR story |

Secrets are per Worker; set them on `eddies-portfolio` and
`eddies-portfolio-staging` separately. They apply without a redeploy.

**Approval page says the email didn't send.** Email Sending needs Workers Paid;
on Free there is no binding. The page shows the code inline — pass it on. See
`AIR-SETUP.md` §3.


### Smoke test fails on flags the code clearly gates

Symptom: the production smoke test reports sections that "should be hidden"
are linked, but visiting the site by hand shows them correctly hidden, and the
next deploy of the same code passes.

**Cause.** The smoke test ran against the *previous* Worker version. For a
moment after `wrangler deploy` returns, the edge still serves the old version.
The readiness gate only required a non-5xx response, and the old version
answers 200 perfectly well — so the gate passed under a second and handed the
smoke test a stale page.

This is how the deploy of the section-gating commit went red. The giveaway is
in the gate's own output:

```
Deployed eddies-portfolio triggers
ready after 1 attempt(s): /:200 /blog/:200 /works/:200 /air/:200
```

`/air/:200` — only the pre-gating build ever returned that; the new one 404s.

**Fix.** Already handled: every page carries
`<meta name="build-sha" content="...">`, and the deploy passes
`EXPECT_BUILD_SHA` to `wait-for-http.sh`, which now waits until the served
stamp matches the commit that was built. Do **not** set that variable against
an Access-gated hostname — the login interstitial carries no stamp, so the
gate could never be satisfied.

**Check what is live by hand:**

```bash
curl -s https://eddie.engineering/ | grep build-sha
```

---

### Smoke test reports "gated by Cloudflare Access… skipping"

**Cause.** No Access service token, so the suite can't reach a gated preview.
This is a **skip, not a pass** — deliberately loud.

**Fix.** Zero Trust → Access → **Service Auth** → create a token, add it to
the policy for `*-dev.eddie.engineering`, then set `CF_ACCESS_CLIENT_ID` and
`CF_ACCESS_CLIENT_SECRET` as repo secrets.

---

### Images render locally but are broken once deployed

**Cause.** The asset files were never committed. A **global** gitignore
(`~/.gitignore_global`) containing `Icon?` — the macOS Finder rule — matches a
directory named `icons` case-insensitively, so git never descends into it.

**Fix.** Don't name asset directories `icons` (this repo uses `public/brand`).
A test asserts every locally-referenced icon is tracked in git, so this fails
in CI rather than in production.

```bash
git check-ignore -v <path>    # shows which rule, in which file, excluded it
```

---

### `versions upload` fails: "Worker does not yet exist"

**Cause.** `wrangler versions upload` cannot create a Worker.

**Fix.** Not applicable to the current setup — every tier uses `wrangler
deploy`, which creates the Worker if absent. If you reintroduce version
previews, bootstrap once with a `deploy`.

---

### CI passes but a deploy job fails on install

**Symptom.** `nx ... couldn't be built successfully (exit code 129)`.

**Cause.** Cold Yarn cache rebuilding native postinstalls.

**Fix.** Already handled: all workflows share `.github/actions/setup`, which
caches and retries the install once.

---

### A workflow run fails instantly with 0s duration

**Cause.** Invalid workflow YAML — usually committed merge-conflict markers.

**Fix.**
```bash
grep -rn '^<<<<<<< \|^>>>>>>> ' .github/
ruby -ryaml -e 'Dir.glob(".github/workflows/*.yml").each { |f| YAML.load_file(f); puts "OK #{f}" }'
```

---

### Working on sealed content

The markdown is the source you edit; the blob is what gets committed. `seal`
keeps your file — it used to delete it, which made the blob the only copy and
turned your own draft into something you had to decrypt to read.

```bash
# write it, seal it, keep editing
node scripts/seal-content.mjs seal packages/web-astro/src/content/blog/my-post.md

# what is sealed, and has anything drifted?
node scripts/seal-content.mjs status

# after editing — the pre-commit hook also does this automatically
node scripts/seal-content.mjs reseal-if-changed
```

`status` reports three states per file:

| State | Meaning |
|---|---|
| `sealed only` | No local copy. `unseal <path>` to get one. |
| `local copy matches` | Blob is current. |
| `LOCAL COPY MODIFIED` | The blob is stale — a deploy would publish the **old** text. Reseal. |

The plaintext is never committed, but that is enforced rather than achieved by
deleting it: the pre-commit hook refuses it, and `audit` fails CI if it slips
through. It is deliberately not gitignored — an ignore list would have to name
the files, which leaks exactly what the opaque blob names hide.

**A fresh clone has blobs and no markdown.** Run `unseal-all` to get working
copies. CI does this at build time.

---

---

### A required status check never reports

Symptom: a PR sits at *"Expected — Waiting for status to be reported"* forever,
and merging is blocked with nothing failing.

**Cause.** Required checks are matched by **check-run name**, which for Actions
is the job's `name:`. Renaming a job silently unprotects the branch *and* leaves
the old name required — so it waits for a check that no longer exists.

**Fix.** Settings → Rules → the branch ruleset → remove the stale name, add the
current one. The names CI reports today:

| Check | Workflow | Required? |
|---|---|---|
| `tests` | `ci.yml` | yes |
| `e2e` | `ci.yml` | yes |
| `preview` | `preview.yml` | yes |
| `Detect deployable changes` | `preview.yml` | yes — the only proof the workflow ran when `preview` is skipped on a docs-only PR |

If you rename a job, update the ruleset in the same change.

---

### A stale Cloudflare Pages project keeps building

Symptom: a red `Cloudflare Pages — Building` check on every PR, unrelated to
anything in the diff.

**Cause.** The `eddies-portfolio` Pages project still has Git integration
pointing at this repo. The site moved to a Worker; Pages builds the tree, fails,
and reports a check nobody asked for. It is also a domain hazard — a hostname
belongs to one service, and a Pages project that claims `eddie.engineering`
takes it from the Worker.

**Fix.** Cloudflare dashboard → Workers & Pages → `eddies-portfolio` (Pages) →
Settings → disconnect the Git integration, then delete the project. Confirm the
Worker still owns the hostname afterwards:

```bash
curl -s https://eddie.engineering/ | grep build-sha
```

---

## Procedures

### Move a custom domain between services

Order matters — a hostname binds to one service.

1. Remove it from the current owner (Pages project → Custom domains, or the
   Worker's Domains & Routes).
2. Deploy the new owner immediately to minimise the gap:
   ```bash
   yarn nx build web-astro
   npx wrangler deploy -c packages/web-astro/dist/server/wrangler.json
   ```
3. Verify: `yarn smoke https://<host>`

Rolling back means reversing step 1. Expect a brief window while DNS and
certificates settle.

### Roll back production

Cloudflare keeps prior Worker versions.

```bash
npx wrangler deployments list -c packages/web-astro/dist/server/wrangler.json
npx wrangler rollback [version-id] -c packages/web-astro/dist/server/wrangler.json
yarn smoke https://eddie.engineering
```

Or revert the commit and let the pipeline redeploy — slower, but keeps git and
production in agreement.

### Publish or unpublish a post now

```bash
yarn posts:queue          # current state
```

- Publish immediately: set `draft: false` and remove `publishDate` (or set it
  to the past).
- Schedule: `draft: false` + a future `publishDate`.
- Pull a live post: set `draft: true` — it 404s on the next request, no deploy
  needed.

### Clean up an orphaned preview Worker

`preview-cleanup.yml` handles PR close. If one is stranded:

```bash
npx wrangler delete --name eddies-portfolio-pr-<N> --force
npx wrangler kv namespace list      # then delete <worker>-session if present
```

### Verify a deployment by hand

```bash
./scripts/wait-for-http.sh https://<host>    # readiness
yarn smoke https://<host>                    # behaviour
```

Add `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` for gated hosts.

---

## Standing risks

- **`freeman.codes`** sits on the Pages project in an `Inactive (Error)` state.
  Unrelated to this pipeline; don't sweep it up during domain work.
- **The Pages project still exists** after the Workers migration. It serves
  nothing once its domains are released, but deleting it is a one-way door —
  confirm no domain still points at it first.
