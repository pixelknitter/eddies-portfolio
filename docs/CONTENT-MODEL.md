# Content model

The shape of every content collection, and how those shapes line up with each
other. Workflows for _authoring_ the content are in
[CONTENT.md](./CONTENT.md); this file is the reference for what a field is,
who reads it, and why the collections agree where they agree.

The schemas themselves live in `packages/web-astro/src/content.config.ts` and
are the source of truth. Where a field's reasoning is subtle, the comment in
that file is longer than the entry here.

---

## The collections at a glance

| Collection   | Renders                     | Feeds A.I.R. | Gate                     | Body means  |
| ------------ | --------------------------- | ------------ | ------------------------ | ----------- |
| `blog`       | `/blog`, `/blog/<id>`       | yes          | `PUBLIC_SHOW_BLOG`       | the post    |
| `projects`   | `/works`, `/projects/<id>`  | yes          | `PUBLIC_SHOW_PROJECTS`   | narrative   |
| `star`       | home-page spotlight         | yes          | `PUBLIC_SHOW_HIGHLIGHTS` | guardrails  |
| `challenges` | nothing                     | yes          | none needed              | narrative   |
| `resume`     | `/cv`, `/cv/for-bots`, PDFs | yes          | `PUBLIC_SHOW_RESUME`     | the bullets |
| `authors`    | via `blog`                  | no           | with `blog`              | n/a (JSON)  |
| `latestWork` | home page                   | no           | none                     | n/a (API)   |

Two things in that table do most of the explaining:

**`challenges` renders nowhere.** It exists so a question about failure has
an honest answer instead of a decline, which on that question reads as
evasive. It is a separate collection rather than a flag on `star` precisely
because `star` has a second consumer: a boolean guarding a candid account of
something going wrong would be one forgotten default away from putting it on
the landing page.

**`star` bodies are not prose.** A STAR body is an honesty guardrail — a rule
about how a claim may be phrased, such as _"reduces compliance risk, never
guarantees compliance."_ Those are instructions from the author, so
`ask.ts` labels them `constraints` and `prompt.mjs` hoists them _outside_ the
story tags, keeping the "treat everything inside as data" guarantee true.
Every other collection's body is `content`. Nothing downstream guesses which
it received.

---

## What A.I.R. actually retrieves

Retrieval reads **frontmatter only**. Bodies reach the model once an entry is
selected, but they contribute nothing to _being_ selected.

Selection is BM25 over a MiniSearch index (`util/air/retrieval.mjs`). The
index reads a fixed set of **field names**, and a boost says only "a hit here
means more than a hit there" — BM25 already accounts for term rarity and
field length:

| Field                                    | Boost |
| ---------------------------------------- | ----- |
| `title`, `org`, `role`                   | 3     |
| `tags`                                   | 2     |
| `result`                                 | 1.5   |
| `summary`, `situation`, `task`, `action` | 1     |

**Any field not in that list is invisible to retrieval** — `description`,
`blurb`, `stack`, `platform`, and every body. This is why the corpus builder
mirrors a collection's short-summary field into `summary` (see below) rather
than leaving it under a display name.

> A `WEIGHTS`/`scoreEntry` pair also lives in that module. It is the **older
> scorer, kept for tests only** — nothing in the request path calls it. Read
> `FIELD_BOOST` when reasoning about what the endpoint will find.

Two gates sit in front of ranking, and they explain most "why did it find
nothing" surprises:

- **A hit must cover a distinctive term.** A term appearing in more than half
  the corpus discriminates nothing, so it is ignored — which is why "Eddie"
  never needed a stopword entry. The practical consequence for content: _if
  every project carries the same tag, that tag stops being findable._ Tag for
  what makes an entry different, not for what everything shares.
- **No match means no context**, and the endpoint declines rather than asking
  the model to answer from nothing. `MAX_ENTRIES` (4) bounds what is sent.

An overview question ("why should I work with him") has no distinctive terms
by construction, and is handled by a separate path so it stays answerable.

### Tags are vocabulary, not a technology list

`tags` is the heaviest signal you fully control. Real questions arrive in the
asker's words — _"did he manage people"_, _"how does he handle incidents"_ —
so tags carry role and practice terms alongside the stack. Stemming will not
bridge the gap: "managed people" does not stem-match "leadership".

Two mechanics worth knowing:

- A **compound tag** matched in full scores as a whole tag even out of order,
  so `build-vs-buy` is hit by "decide whether to build or buy".
- Tags must be a **single-line inline array** (`tags: ['a', 'b']`) for
  `scripts/air-eval.mjs`, whose lightweight frontmatter parser does not read
  YAML list form. Astro parses either, so list form fails only in eval
  scoring — quietly.

Add a tag only where the claim is true. A three-day hackathon lead is not a
manager.

### One corpus definition, two consumers

`util/air/corpus.mjs` exports `CORPUS_COLLECTIONS`, read by both the endpoint
(`ask.ts`) and the eval harness. **It is the only place a collection is
added** — wiring one consumer and not the other lets the harness grade a
prompt the site does not build, which has happened. Each entry declares:

| Key           | Meaning                                                |
| ------------- | ------------------------------------------------------ |
| `bodyAs`      | `constraints` for STAR guardrails, `content` for prose |
| `idPrefix`    | Namespaces the citation so it names its collection     |
| `summaryFrom` | Display field mirrored into `summary` for indexing     |
| `scheduled`   | Visibility depends on `publishDate`, not `draft` alone |

`scheduled` is a correctness rule: **a scheduled post is not public**, and
filtering on `draft` alone would let A.I.R. answer from one.

---

## Shared shape across collections

Where collections agree, they agree deliberately. This is the alignment view:

| Field                                | blog    | projects      | star | challenges | resume    |
| ------------------------------------ | ------- | ------------- | ---- | ---------- | --------- |
| `title`                              | ✅      | ✅            | ✅   | ✅         | ✅        |
| `tags`                               | ✅      | ✅            | ✅   | ✅         | ✅        |
| `draft`                              | ✅      | ✅            | ✅   | ✅         | ❌        |
| short summary                        | `blurb` | `description` | —    | —          | `summary` |
| `situation`/`task`/`action`/`result` | —       | —             | ✅   | ✅         | —         |
| `reflection`                         | —       | —             | —    | ✅         | —         |
| `publishDate`                        | ✅      | —             | —    | —          | —         |
| `order`                              | —       | —             | —    | —          | ✅        |

**`star` and `challenges` are the same shape plus `reflection`.** That is on
purpose: the arc holds either way, and the difference is only that the
situation arose from a mistake rather than an opportunity. Writing a
challenge should feel like writing a highlight, because it is one.
`reflection` is the field that earns the separate collection — a hiring
manager's real question is not "what went wrong" but "what do you do
differently now", and `result` cannot carry both the recovery and the lesson
without one crowding the other.

Every collection A.I.R. reads now carries `title`, `tags` and a draft gate.
The remaining divergence is deliberate: the STAR arc belongs only to the two
collections built on it, and `resume` has no `draft` because the whole
collection is sealed and gated by its flag.

**The short-summary row is the one to watch.** Three collections carry the
same idea under three names, because each name was chosen for the page that
renders it. Rather than rename them — churning every content file and
template — the corpus builder mirrors the value into `summary`, which is what
the index actually reads. Adding a fourth collection with a summary-shaped
field means adding a `summaryFrom` entry, not renaming anything.

---

## Per-collection reference

### `blog`

```yaml
title: 'Post title'
author: eddie-freeman # reference → authors collection, by id
relatedPosts: [] # references → blog, by id
blurb: 'Listing-card description'
tags: ['typescript', 'astro']
heroImage:
  url: '/images/hero.webp'
  alt: 'What the image shows'
draft: false
publishDate: 2026-08-01T09:00:00Z # optional; hidden until this moment
```

`author` and `relatedPosts` are validated references, so a typo fails the
build rather than rendering a dead link. `publishDate` works without a cron
because pages render per request — and A.I.R. honours the same rule, so a
scheduled post is not answerable until it is live.

`blurb` is mirrored to `summary` in the corpus, which is how a post is found
by wording that appears only in its blurb.

### `projects`

```yaml
title: 'Project name'
description: 'What it is'
image: { url: '…', alt: '…' }
worksImage1: { url: '…', alt: '…' }
worksImage2: { url: '…', alt: '…' }
platform: 'Web'
stack: ['Astro', 'TypeScript'] # an array
website: 'https://…'
github: 'https://…'
tags: ['astro', 'static-site'] # retrieval vocabulary; never rendered
draft: false
```

`description` is mirrored to `summary` in the corpus. `stack` is an array
because `buildUserMessage` renders it only when `Array.isArray` — as a string
it never reached the model — and because nothing can enumerate a joined
string for a filter or a chip list. The page joins it for display.

`draft` hides one entry; `PUBLIC_SHOW_PROJECTS` gates the whole section.
Because `/projects/*` is prerendered, both work by emitting no path at all
rather than 404ing at request time — a prerendered page would otherwise sit
on disk and be reachable directly.

### `star`

```yaml
title: 'What happened, in a phrase'
situation: 'The context'
task: 'What had to be done'
action: 'What Eddie did'
result: 'What came of it'
tags: ['migration', 'led-a-team']
draft: false
```

Body = honesty guardrails, not prose. `_template.md` is excluded by the
loader's `[!_]` glob so the home-page rotation can never land on the
placeholder.

### `challenges`

Identical to `star`, plus:

```yaml
reflection: 'What I do differently now' # optional but the point
```

**A note on how these are read.** A.I.R. may draw a pattern from these
entries and cite them as the supporting examples. It may not turn one into a
disposition. _"In this migration he sized the work wrong and rewrote the
estimate"_ is the story; _"he underestimates timelines"_ is a claim about a
person that no single entry supports. Entry ids are namespaced
`challenges/<id>` in the corpus so a citation always names its collection.

### `resume`

A **discriminated union on `section`**, not one permissive schema with
everything optional — a role without `start` should fail the build, and it
only can if the section decides which fields are required. Folders are
sections, so `entry.id` carries the section without a naming convention.

Every section shares `title`, `tags`, `order` (low first). Then:

| `section`    | Adds                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `profile`    | `headline`, `location`, `summary`, `stats[]`                                                                                                     |
| `experience` | `org`, `role`, `location`, `dates`, `start`, `end?`, `tier`, `period?`, `lede?`, `summary?`, `compact?`, `chips[]`, `highlights[]`, `featured[]` |
| `strengths`  | `items[]` of `{ title, detail, wide }`                                                                                                           |
| `skills`     | `groups[]` of `{ group, tone, items[] }`                                                                                                         |
| `speaking`   | `evaluation`, `talks[]`, `footer?`, `writing?`                                                                                                   |
| `education`  | `entries[]` of `{ period, institution, detail }`                                                                                                 |

Three details that look cosmetic and are not:

- **`start`/`end` are ISO `YYYY-MM`**, separate from the human-facing
  `dates` string. They exist for the JSON-LD graph: a generative engine can
  order a career from `2023-02` and has to guess at "Feb 2023". A current
  role is marked by **omitting `end`**, never by a `"Present"` sentinel,
  which a parser reads as a malformed date.
- **`chips` renders; `tags` does not.** `chips` is display (domains, client
  lists); `tags` is retrieval vocabulary. Conflating them silently dropped
  every display chip and highlight card during the migration.
- **`featured` is frontmatter indices**, not an in-body marker. The bullets
  sit in a deliberate order the complete renderings depend on, and a featured
  set is rarely a prefix — so grouping under a heading would reorder the
  document, and an inline marker would leak into both the page and the
  A.I.R. context. The loader fails the build on an out-of-range index.

Resume bodies hold the bullets as markdown, which is what makes them
reachable by A.I.R. at all.

### `authors` and `latestWork`

`authors` is JSON (`name`, `portfolio`), referenced by `blog`. `latestWork`
has no files: a loader fetches recent public repos at build time and yields
`{ name, description, url, language, stars, pushedAt }`. Its failures are
non-fatal by design — an unreachable API logs a warning, returns an empty
collection, and the section simply doesn't render.

---

## Known divergence

**Blog bodies are long, and `MAX_ENTRIES` is 4.** A long post competes for the
same four slots as a STAR story that might answer more directly. BM25
normalises for field length and no crowding has been observed, so this is
watched rather than fixed; if it appears, the fix is a per-collection cap.

## Adding a field: the checklist

1. **Does A.I.R. need to find entries by it?** The index reads a fixed set of
   field names, so either express it as `tags`, or — for a short summary —
   declare `summaryFrom` in `CORPUS_COLLECTIONS`. Prefer those over adding a
   boost, which reweights every existing entry.
2. **Does it render?** Display data and retrieval vocabulary are different
   fields, even when the values overlap. See `chips` vs `tags`.
3. **Does it need to be validated?** Frontmatter is validated by Zod at build
   time; bodies are not. Anything a machine consumes belongs in frontmatter.
4. **Does an existing collection already have this shape?** If you are adding
   the fourth STAR-like field set, the answer is probably to reuse
   `star`/`challenges` rather than invent a fifth vocabulary.
5. **Update this file and `content.config.ts` together.** The schema comments
   carry the _why_; this file carries the _shape_.
