# Content runbook

Day-to-day workflows for writing and publishing: posts, projects, STAR
stories, and the sealed resume content. The operational counterpart —
failures, infrastructure, deploys — is [RUNBOOK.md](./RUNBOOK.md). For the
full field reference and how the collections align,
see [CONTENT-MODEL.md](./CONTENT-MODEL.md).

**The model in one paragraph.** Everything is a content collection
(`packages/web-astro/src/content/`), every section is gated by a build-time
flag that 404s the whole route when off, and pages render per request. That
last part is the load-bearing decision: because nothing is prerendered to
disk, publishing is a _data_ change — flip `draft`, or let a `publishDate`
pass — and it takes effect on the next request. No cron, no rebuild, no
deploy. (Why not prerender? A prerendered page exists on disk and is
reachable by direct URL regardless of its date — see
[DECISIONS.md](./DECISIONS.md#content--publishing).)

```bash
yarn posts:queue     # what's live, scheduled, drafted — start here
```

**Start from a template.** Every collection ships a `_template.md` carrying
the field shapes and the reason each field matters. Copy it rather than an
existing entry — the loader's `[!_]` glob keeps templates out of the
collection, so they can explain themselves at length without rendering
anywhere.

| Collection   | Template                              |
| ------------ | ------------------------------------- |
| `blog`       | `src/content/blog/_template.md`       |
| `projects`   | `src/content/projects/_template.md`   |
| `star`       | `src/content/star/_template.md`       |
| `challenges` | `src/content/challenges/_template.md` |

---

## Add a blog post

Create `packages/web-astro/src/content/blog/<slug>.md`. The filename is the
URL: `/blog/<slug>`.

```markdown
---
title: 'My Post Title'
author: eddie-freeman
relatedPosts: []
tags: ['typescript', 'astro']
blurb: 'One-sentence description for the listing card.'
heroImage:
  url: '/images/hero.webp'
  alt: 'What the image shows'
draft: true
---

Body in markdown…
```

- `draft: true` posts are invisible in production but render on staging and
  per-PR previews (they set `PUBLIC_SHOW_UNPUBLISHED=true`) — so a draft can
  be reviewed at a real URL before it exists publicly.
- **Posts are part of A.I.R.'s corpus**, so `tags` and `blurb` are how a
  visitor's question finds a post. A draft or scheduled post is not
  answerable until it is live, by the same rule that hides the page.
- `author` references an entry in `content/authors/` by id; `relatedPosts`
  references other posts by slug. Both are validated at build time, so a
  typo fails the build instead of rendering a broken link.
- Images go in `public/` and are referenced without the `/public` prefix.

## Import a post from Obsidian

```bash
node scripts/obsidian-import.mjs <note.md> [--vault dir] [--slug s] [--publish] [--dry-run]
```

The importer rewrites wikilinks and embeds, maps frontmatter to the schema,
and copies attachments out of the vault. Two behaviours are deliberate:

- **Links to unpublished notes degrade to plain text.** A link that 404s for
  every reader is worse than no link.
- **Inline `#tags` become frontmatter tags but the word stays in the prose.**
  Code fences, headings and hex colours are left alone.

Imports default to `draft: true` — publishing stays a separate decision.

**Sync the whole vault folder in one command** — import every note in
`<vault>/writing/blog/`, then apply the sealing policy (unpublished notes
seal, published notes stay plaintext, unchanged notes touch nothing so the
vault does not churn):

```bash
CONTENT_SEAL_KEY="$(<~/.config/eddies-portfolio/content-seal.token)" yarn blog:sync
```

`OBSIDIAN_VAULT` names the vault root (it can live in `.envrc` — it is a
path, not a secret). This is the interim workflow: the endgame is an
Obsidian plugin over `obsidian-publish-core`, specced in
[`packages/obsidian-publish-core/docs/PLUGIN-SPEC.md`](../packages/obsidian-publish-core/docs/PLUGIN-SPEC.md).

## Schedule, publish now, or pull a post

| Intent              | Frontmatter                                                                |
| ------------------- | -------------------------------------------------------------------------- |
| Publish immediately | `draft: false`, no `publishDate` (or one in the past)                      |
| Schedule            | `draft: false` + a future `publishDate` (ISO, e.g. `2026-08-01T09:00:00Z`) |
| Pull a live post    | `draft: true` — it 404s on the next request                                |

`yarn posts:queue` confirms the current state. Because the date check runs
per request, none of these need a deploy — but the _file change_ still needs
to reach production, so commit and let the pipeline promote it.

## Add a project

Create `packages/web-astro/src/content/projects/<slug>.md`:

```yaml
title: 'Project name'
description: 'What it is, in a sentence'
image: { url: '/card.webp', alt: '…' }
worksImage1: { url: '/detail-1.webp', alt: '…' }
worksImage2: { url: '/detail-2.webp', alt: '…' }
platform: 'iOS'
stack: ['Swift', 'SwiftUI'] # an array, not a joined string
website: 'https://…'
github: 'https://…'
tags: ['swift', 'ios', 'mobile'] # how A.I.R. finds it; never rendered
draft: false
```

It appears on `/works/` and generates `/projects/<slug>`, both gated by
`PUBLIC_SHOW_PROJECTS`. Project pages are the one prerendered section, so the
gate works differently: when the flag is off the routes are never emitted,
keeping the pages off disk rather than 404ing at request time. `draft: true`
does the same for a single project.

**Tag for what makes this project different.** Tags are the main way A.I.R.
finds a project, and a term appearing in more than half the corpus is
discarded as non-distinctive — so tagging every project `web` makes `web`
useless. Reach for the specific technology, platform, and problem domain.

## Add a STAR story

Create `packages/web-astro/src/content/star/<slug>.md` — Situation / Task /
Action / Result frontmatter, copied from `_template.md` (which the loader
excludes from the collection, so the spotlight can never land on it).

One story does double duty:

- **Home page spotlight** — one published entry is chosen per request, so
  the highlight rotates between visits (`PUBLIC_SHOW_HIGHLIGHTS`).
- **A.I.R.'s corpus** — `draft: false` makes a story answerable. Frontmatter
  `tags` are the retrieval vocabulary: use the words a question would
  actually contain ("managed people", not just the stack), and only where
  the claim is true.

## Working on sealed content

Personal content (the real resume, some drafts) is committed encrypted. The
markdown is the source you edit; the blob is what gets committed. `seal`
keeps your file — the plaintext working copy stays yours to edit.

```bash
# write it, seal it, keep editing
node scripts/seal-content.mjs seal packages/web-astro/src/content/blog/my-post.md

# what is sealed, and has anything drifted?
node scripts/seal-content.mjs status

# after editing — the pre-commit hook also does this automatically
node scripts/seal-content.mjs reseal-if-changed
```

`status` reports three states per file:

| State                 | Meaning                                                              |
| --------------------- | -------------------------------------------------------------------- |
| `sealed only`         | No local copy. `unseal <path>` to get one.                           |
| `local copy matches`  | Blob is current.                                                     |
| `LOCAL COPY MODIFIED` | The blob is stale — a deploy would publish the **old** text. Reseal. |

The plaintext is never committed, but that is enforced rather than achieved
by deleting it: the pre-commit hook refuses it, and `audit` fails CI if it
slips through. It is deliberately **not** gitignored — an ignore list would
have to name the files, which leaks exactly what the opaque blob names hide.

**A fresh clone has blobs and no markdown.** Run `unseal-all` (needs
`CONTENT_SEAL_KEY`) to get working copies. CI does this at build time;
without the key, resume routes render fixtures or 404 — see
[RESUME.md](./RESUME.md#sealing-and-fixtures).

## Edit the resume

The resume is sealed content with an extra constraint: the two downloadable
PDFs are build artifacts, and a spec fingerprints every file they are
generated from — data, print layout, _and_ stylesheets. Touch any of them
and the spec fails until you regenerate:

```bash
yarn resume:pdf     # then commit src/util/resume/pdfs.generated.mjs
```

The full story — content model, fixtures, watermarking, why the fingerprint
hashes inputs not output — is [RESUME.md](./RESUME.md).

## Writing voice

[VOICE.md](./VOICE.md) is the working definition of the voice posts are
written and edited in — register, rhythm, imagery, and the anti-patterns
that read as off-voice.
