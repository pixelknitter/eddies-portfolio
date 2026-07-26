# Research: publishing from Obsidian

**Question.** How should an Obsidian vault publish posts into this repo's
Astro blog collection, and is a custom plugin justified?

**Date.** July 2026. Obsidian desktop 1.13.3; `obsidian-api` tracks 1.13.2.

**Recommendation.** A thin Obsidian plugin calling a Cloudflare Worker that
opens a PR — staged, with the first step useful on its own.

---

## Why not just use an existing plugin

Nine candidates were evaluated. **None supports configurable frontmatter
mapping** — not one lets you declare `cover → heroImage.url`.

That is disqualifying here specifically, because of three things in
`packages/web-astro/src/content.config.ts`:

1. **`relatedPosts` is required, not optional**, and uses `reference('blog')`.
   A plugin that copies raw frontmatter produces a file that fails
   `astro check` and breaks the build.
2. **`heroImage` is a nested object** `{ url, alt }`. Flat key mapping cannot
   produce it.
3. **`author` uses `reference('authors')`** — the value must resolve to an
   entry in another collection.

There is also a fourth problem no vault-side plugin can solve: `convertWikilinks`
takes `knownSlugs` and deliberately downgrades links to unpublished notes to
plain text, because *a dangling link 404s for every reader*. That set is derived
from **the target repo's** contents, which the vault does not know.

## The candidates

> **Naming trap.** Three plugins have near-identical names. The one in the
> registry as `github-publish` is Rouiller's (3★, self-described prototype) —
> *not* the capable one.

| Plugin | Frontmatter mapping | Notes |
|---|---|---|
| [Enveloppe](https://github.com/Enveloppe/obsidian-enveloppe) (ex-GitHub Publisher) | Whole-file regex only | Strongest option. Real PR workflow, excellent attachments, Apache-2.0, active |
| [Obsidian Git](https://github.com/Vinzent03/obsidian-git) | None — raw sync | Its own README calls mobile *"highly unstable ⚠️"* |
| [Digital Garden](https://github.com/oleeskild/obsidian-digital-garden) | Hardcoded `dg-*`; mangles other keys | Coupled to its own Eleventy template. 214 open issues / 2.4k★ |
| [Quartz Syncer](https://github.com/saberzero1/quartz-syncer) | Toggles only | Best-in-class token storage; only relevant on Quartz |
| [Static Site MD Exporter](https://github.com/yy4382/obsidian-static-site-export) | Tag flattening | Dormant ~8 months; base64-inlines images or aborts |

**Enveloppe's escape hatch and its risk.** `censorText` runs `String.replace`
over the *entire file including frontmatter*, so
`/^cover: (.*)$/m → heroImage:\n  url: $1` genuinely works. But it is blind text
substitution with no YAML parser behind it — no awareness of quoting, block
scalars, or whether the match landed in prose. It will silently corrupt notes
whose body contains a matching line.

## Recommended architecture

```
Obsidian plugin (thin)                Cloudflare Worker (the service)
──────────────────                    ────────────────────────────────
read active note                      verify bearer token
collect embeds via MetadataCache      GET blog/*.md → knownSlugs
readBinary each attachment            convert (shared core lib)
POST {note, attachments[]} ─────────► PUT contents on branch blog/<slug>
  via requestUrl                      open or update PR → master
show Notice with PR link              ◄──── { prUrl, previewUrl }
```

**Why a service rather than the plugin pushing to GitHub directly:**

- **Blast radius.** A `contents:write` PAT on a laptop *and* a phone can
  rewrite the public portfolio. A Worker-issued bearer token can only say
  "make a blog PR", and is revocable per device without touching GitHub.
- **Conversion runs where `knownSlugs` lives** — no extra round-trips, no
  stale link resolution.
- **Mobile works** (see below).
- **Shared, tested code.** The Worker imports the same core the site imports.
  Regex rules cannot be unit-tested against a Zod schema.

**The existing pipeline already does the hard part.** A draft landing as a PR
gets a live preview URL for free (`PUBLIC_SHOW_UNPUBLISHED` on previews), and
`astro check` validates the schema before merge. "PR, not master" is not just
safer here — it is better UX.

**Fallback if effort is the binding constraint:** Enveloppe with
`automaticallyMergePR: false`, plus a CI job that fixes frontmatter and commits
into the same PR. No plugin to write. Cost: frontmatter shaping lives in blind
regex rather than tested code.

## Mobile and desktop

Both, and it is a consequence of the architecture rather than extra work.
Obsidian's docs state only **Node.js and Electron APIs** are unavailable on
mobile; `isDesktopOnly: true` is required only if you use them.

| API needed | Mobile |
|---|---|
| `requestUrl` | ✅ Obsidian's own; bypasses CORS |
| `Vault.read` / `readBinary` | ✅ |
| `MetadataCache.getFirstLinkpathDest` | ✅ |
| `FileSystemAdapter.getBasePath()` | ❌ desktop only — **avoid** |

This is exactly why Obsidian Git struggles on mobile and this design does not.

## Distribution

**BRAT installs plugins from GitHub *release assets*, not the repo tree** —
verified in its source (`grabReleaseFileFromRepository(release, "main.js" | "manifest.json")`).
Only *themes* are read from the repo root.

Two consequences:

- **The plugin can live in this monorepo.** It needs a release workflow that
  attaches `main.js` + `manifest.json`; no separate repo required.
- BRAT's own manifest is `isDesktopOnly: false`, so beta installs work on
  mobile too.

The community directory is the only path needing more — submission plus
automated review, which since May 2026 is a dashboard rather than a GitHub PR.

**Registry naming rules:** lowercase-hyphen, cannot contain `obsidian`, cannot
end with `plugin`. So `astro-blog-publisher` is valid; `obsidian-astro-plugin`
is not.

## Secrets

`loadData()`/`saveData()` write **plaintext** — the official guide says so
outright. Use `app.secretStorage` (Obsidian 1.11.4+; OS-keychain encryption at
rest since 1.11.5). Secrets are per-vault and do not sync.

## Nx packaging

No generators needed. `nx.json` extends `nx/presets/npm.json`, Nx recognises a
project from `package.json` or `project.json` alone, and `packages/*` is
already a Yarn workspace glob.

```
packages/
  obsidian-publish-core/     # pure, Node-free → runs in workerd AND node
  obsidian-publish-worker/   # Cloudflare Worker
  obsidian-publish-plugin/   # esbuild → main.js + manifest.json
```

The core **must stay Node-free** so it runs in workerd; filesystem work belongs
in the CLI and Worker shells. That is already how `obsidian.mjs` is factored.

## Staged plan

1. **Extract `packages/obsidian-publish-core/`** — relocate the converter and
   its tests, and move the frontmatter→schema mapping out of the CLI. No
   behaviour change; tests stay green. Required by *every* path, including the
   Enveloppe fallback.
2. **Build the Worker** with a single `POST /publish`. Test it by pointing the
   existing CLI at it — no plugin yet. This is where you learn whether the
   PR-and-preview loop feels good.
3. **Then the plugin**, from `obsidian-sample-plugin`: one command, endpoint +
   token in `app.secretStorage`, declarative settings API, and run
   `eslint-plugin-obsidianmd` locally — it is the same linter the automated
   review uses.
4. **GitHub auth**: start with a fine-grained PAT (`Contents: Write`,
   `Pull requests: Write`) as a Worker secret; move to a GitHub App for
   short-lived tokens if it matters.

## Unverified

Recorded so nobody assumes these were checked:

- Enveloppe's fine-grained token support
- Quartz Syncer attachment path rewriting
- `requestUrl` restrictions beyond HTTP/HTTPS
- `app.secretStorage` at-rest behaviour **on mobile** — the 1.11.5 encryption
  note is desktop-specific
- Obsidian's plugin-review timings are self-reported

Mitigation for the secret-storage gap is already in the design: the device
holds a scoped, revocable bearer token, not a GitHub PAT.
