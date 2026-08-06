# Obsidian plugin — spec

The next project this package exists for. `obsidian-publish-core` was
extracted dependency-free precisely so an Obsidian plugin could wrap it;
this document is the brief for building that plugin, written while the
interim workflow (`yarn blog:sync`) is fresh enough to know exactly which
frictions the plugin removes.

## The problem

Publishing a note today takes three contexts: write in Obsidian, run the
import/sync script in a terminal, seal and commit in git. The script
(`scripts/blog-sync.mjs`) collapsed the middle, but the author still leaves
the editor to publish, and nothing validates a note *while it is being
written* — schema failures, over-long hooks, or a `related` ref to an entry
that does not exist surface at import time or in CI, not at the moment the
mistake is made.

## The shape

A thin desktop Obsidian plugin over `obsidian-publish-core`. The core
library keeps doing everything it does today — wikilink/embed rewriting,
frontmatter mapping, tag extraction, serialisation — and the plugin
contributes only what needs Obsidian: commands, editor decorations, and
settings. Any conversion behaviour the plugin needs that the core lacks
gets added to the core *with specs*, never implemented plugin-side. That
boundary is the whole architecture.

**Desktop only.** Publishing writes into a local git checkout and shells
out to the repo's seal tooling; mobile Obsidian has neither filesystem
reach nor a shell. The plugin should detect mobile and disable itself
politely.

## Settings

| Setting | What it is |
|---|---|
| `repoPath` | Absolute path to the portfolio checkout |
| `notesFolder` | Vault folder treated as the blog source (default `writing/blog`) |
| `sealCommand` | Command template for sealing, default `CONTENT_SEAL_KEY="$(<~/.config/eddies-portfolio/content-seal.token)" node scripts/seal-content.mjs seal {path}` |

**The key never enters plugin storage.** The seal command sources it by
path at execution time, same as the runbook one-liner — plugin settings
live in the vault as plaintext JSON, which is exactly where a secret must
not be. This is a hard constraint, not a default.

## MVP

1. **Publish command** (palette + editor menu): convert the active note via
   the core, write it into `repoPath`'s blog collection, then apply the
   sealing policy — unpublished notes seal (via `sealCommand`), published
   notes stay plaintext, unchanged notes touch nothing (byte-compare
   against the `.local-blog/` working copy; re-sealing identical content
   churns the vault with fresh ciphertext). This is `blog-sync.mjs`
   behaviour, relocated to where the author already is.
2. **Sync-all command**: the same sweep `yarn blog:sync` does, for the
   whole `notesFolder`.
3. **Result surface**: an Obsidian notice per action — imported, sealed,
   unchanged, published — plus what to do next ("commit the vault"). The
   plugin never runs git itself; committing stays a human act.

## Second pass — the in-editor teacher layer

The validations that today live in CI move into the editor, at the moment
of writing:

- **Schema check**: required fields present, `domain` a string, `tags` an
  array — the things a schema failure would say at import, said inline.
- **Hook lint** (rules from `docs/VOICE.md`): flag a hook over ~20 words —
  usually a description that drifted in — or one that duplicates the blurb.
- **`related` validation**: each `collection/slug` ref checked against the
  repo's real paths *and* `.local-*` working copies (the same union
  `related.spec.ts` uses), so a typo'd ref is underlined while typing, not
  discovered by a spec run.
- **Status indicator**: draft / scheduled / published / sealed-and-current
  vs sealed-but-drifted, read from frontmatter plus repo state. The drift
  case is the valuable one — it is the silent state the seal workflow
  cannot otherwise show you inside Obsidian.

## Later, maybe

- Pull-back sync: repo working copy edited directly → offer to update the
  vault note (today that divergence is silent until the next `--force`
  import overwrites it — the current workflow's sharpest edge).
- Hero/asset handling UI over the core's existing embed extraction.
- Publish scheduling: set `publishDate` from a date picker, with the
  audit's exact rule shown ("this seals until the date passes").

## Non-goals

- **No git operations.** Commit and push remain deliberate human acts —
  the plugin prepares, a person publishes.
- **No key storage, ever.** See settings.
- **No mobile support** in any planned version.
- **No projects-collection authoring** for now: project entries are
  composed hub-and-spoke with sealed working copies and don't originate in
  the vault. Revisit only if that changes.

## Package mechanics

- New workspace package (`packages/obsidian-plugin` or similar), TypeScript,
  esbuild-bundled to the single `main.js` Obsidian requires, plus
  `manifest.json` and `versions.json`.
- Depends on `obsidian-publish-core` via the workspace; the `obsidian` API
  is a dev-time type dependency (provided by the host at runtime).
- Core stays runtime-agnostic and dep-free — the existing contract. Specs
  for any core additions land in the core package, as now.
- Install for development by symlinking the build output into
  `<vault>/.obsidian/plugins/`.
