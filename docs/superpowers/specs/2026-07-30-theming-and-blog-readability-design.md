# Site-wide theming consistency and blog readability

> **Status:** approved, not yet implemented
> **Date:** 2026-07-30
> **Issues:** #50 (theme mapping audit), #47 (blog markdown bugs)
> **Blocked by:** nothing
> **Deliberately excluded:** #46, #52 — see [Out of scope](#out-of-scope)

## Why

Two goals: theming that is consistent across light and dark, and blog posts that
read cleanly. Both turned out to have measurable causes rather than aesthetic
ones, which is what makes this a correctness exercise instead of a redesign.

The design licence is deliberately narrow: **keep the visual identity, change
only what a measurement condemns.** Pacifico stays on every heading in both
themes. No new type scale, no new palette.

## Findings

Everything below was measured, not inferred. Two methods: computed styles read
out of a rendered page via Playwright, and WCAG contrast ratios computed from
the `@theme` token values.

### 1. Six accent tokens have no dark counterpart

Only `--color-surface` and `--color-hairline` are paired with a `-dark` variant.
The sole `.dark` rules in `global.css` are the body background and three icon
swaps — there is no token remapping. So each accent colour is designed for one
theme and used unchanged in both:

| token | value | on light `#fdebf3` | on dark `#1e1e2e` |
|---|---|---|---|
| `--color-link` | `#5dd39e` | **1.63 — fail** | 8.81 — AA |
| `--color-button` | `#5dd39e` | **1.63 — fail** | 8.81 — AA |
| `--color-underline` | `#348aa7` | 3.44 — large text only | 4.17 — large text only |
| `--color-emphasis` | `#525174` | 6.58 — AA | **2.18 — fail** |
| `--color-tag` | `#584966` | 7.17 — AA | **2.00 — fail** |
| `--color-disabled` | `#5c5b77` | 5.70 — AA | **2.51 — fail** |

**Confirmed live failure.** `Footer.astro:42` renders
`<a class="text-link">pixelknitter</a>` against the page background in both
themes — **1.63:1 in light mode, on every page of the site**. `404.astro:12`
does the same via `text-button`. The 3.03:1 already fixed on the resume was the
mild case.

**Not yet confirmed.** The `emphasis` / `tag` / `disabled` rows are ratios
against the *page* background. If those tokens are used as backgrounds rather
than foregrounds at their real usage sites, the relevant sum is different. Do
not treat those three rows as bugs until axe reports them at a real element.

`Card.astro:48` already does this correctly — `border-underline
dark:border-link`, a deliberate per-theme choice. The fix generalises that
existing pattern rather than inventing one.

### 2. Blog posts have no prose typography at all

`Prose.astro` exists but is applied **only on the home page**.
`MarkdownBlogLayout` drops rendered markdown into a bare `<div>`, so posts
receive nothing but Tailwind preflight. Measured on a rendered post:

```
has .prose ancestor on body copy: false
article ul:   listStyleType=none   paddingLeft=0px
article li:   listStyleType=none
article p:    fontSize=14px  lineHeight=20px  marginBottom=0px
body:         textAlign=justify   hyphens=manual
article h2:   Pacifico 30px  underline
```

This makes #47 an incomplete diagnosis. It reports that some passages "read as
lists but have no `-` markers, so they render as separate paragraphs" — true,
but passages that *do* carry markers also render without bullets or indent,
because preflight strips `list-style` and `padding` and nothing restores them.
**Adding the missing markers alone will not fix the rendering.**

Separately, `text-align: justify` with `hyphens: manual` is a defect by
construction: the browser can only pad word-spaces, so long words open rivers of
whitespace. And `marginBottom: 0px` on `<p>` means paragraphs have no
separation.

### 3. Four route families have no `<h1>`

No shared layout renders an `<h1>`; individual pages do it themselves. The
result is inconsistent — exhaustive grep over `.astro` and `.tsx`:

| has `<h1>` | source | no `<h1>` |
|---|---|---|
| `/` | `pages/index.astro:17` | `/blog/` |
| `/404` | `pages/404.astro:9` | `/blog/<post>` — title is `<h2>` at `MarkdownBlogLayout:20` |
| `/air/` | `react/AIResume.tsx:128` | `/works/` |
| `/air/resume/` | `pages/air/resume/index.astro:87` | `/projects/<slug>` |

`content.spec.ts:78` asserts "headings start at h1 and do not skip a level", and
it passes because it only ever visits `/` — which is one of the four pages that
happens to have one. The assertion is real; its coverage is not.

### 4. Dead CSS obscures the live rules

`global.css` lines ~150–230 are commented-out legacy CSS duplicating the live
`@layer base` heading rules. It made the real heading treatment hard to locate
and is a standing trap for the next person.

## Design

### Token layer

Give every accent token an explicit counterpart for both themes, so `dark:`
variants exist and components stop selecting one colour for two grounds.
Generalise the `Card.astro` pattern. Components consume tokens; literals like
`prose-a:text-violet-500` are removed.

The specific replacement values are **not fixed by this spec** — they are
whatever clears 4.5:1 for body text and 3:1 for large text at the real usage
sites, confirmed by axe. Keep the hues; move lightness.

### Blog prose

- `MarkdownBlogLayout` wraps its slot in `Prose`.
- `Prose.astro` drops `prose-a:text-violet-500` for a token, and drops
  `prose-headings:underline`, which currently double-underlines what
  `@layer base` already underlines.
- Prose sets `text-align: left`, overriding the `body { text-align: justify }`
  that cascades into posts. Justification stays everywhere else.
- #47's content fixes (the doubled `>` marker, the missing `-` markers) land in
  the same pass, since they are real independent of layout. Edit the plaintext
  in `.local-blog/`, then `yarn content:seal`.
- Delete the dead CSS at `global.css` ~150–230.

Pacifico stays on all headings, both themes.

### Fixtures

Today's fixtures cannot exercise the audit: the sample post contains `p=2 ul=1
li=1`, and zero links, images, blockquotes, code blocks or tables. axe can only
check elements that exist, so a blog scan against current fixtures comes back
clean by having nothing to look at.

Add `src/content/blog/sample-markdown-kitchen-sink.md`. The `sample-` prefix is
required, not cosmetic — `CONTENT_GLOB` in `content.config.ts` gates fixtures
behind `PUBLIC_SHOW_FIXTURES` by that exact pattern.

It must exercise: `h2`–`h6`; paragraphs including one long enough to show line
length and alignment; emphasis and strong; inline code; a fenced code block with
a language; unordered, ordered and nested lists; blockquotes including a nested
one; images with real alt text, using existing assets in `public/`; internal and
external links; a table; and a horizontal rule.

**The fixture content must itself be correct** — genuine alt text, meaningful
link text, logical heading order. It is a baseline of "good", so that any axe
violation against it is a theming or styling bug rather than a seeded content
bug. A fixture with deliberate faults makes the audit permanently red, and a
permanently red audit gets ignored.

This fixture is also the natural screenshot target for the later visual
regression phase: one page exercising every element the site can render.

Frontmatter must satisfy `BlogSchema`: `title`, `author` (`eddie-freeman`),
`relatedPosts`, `blurb`, `tags`, `heroImage: {url, alt}`, `draft`, optional
`publishDate`.

### Audit tooling

Add `@axe-core/playwright` as a dev dependency. `scripts/a11y-audit.mjs` drives
Playwright directly, walking a route list against **both themes**, toggling via
the site's own `localStorage` mechanism so it matches what visitors get rather
than a synthetic class.

Routes: `/`, `/blog/`, a blog post (the kitchen-sink fixture), `/works/`, a
project page, `/air/`, `/air/resume/`, `/404`.

Scanned with `withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa'])`. Runs against
`astro dev` with the `PUBLIC_SHOW_*` flags and `PUBLIC_SHOW_FIXTURES` enabled,
because real content is sealed.

Two rules it must obey:

1. **`incomplete` is reported separately and never counted as a pass.** This is
   the entire reason axe beats a hand-rolled ratio calculator. When it cannot
   resolve a background it returns a named reason — `bgGradient`, `bgImage`,
   `bgOverlap`, `pseudoContent`, `colorParse`, `elmPartiallyObscured` — rather
   than a confident wrong answer. #50 warned that a naive parser "cannot read
   `color-mix()` backgrounds and will report nonsense"; this is how that is
   avoided.
2. **A script, not an e2e spec, for now.** It stays out of the suite that dies
   mid-run (#52). Promoting it to a spec that fails CI is the first task of the
   later testing phase, once #52 is understood.

axe catches roughly a third of WCAG issues automatically. It supplements the
hand-written checks in `content.spec.ts`; it does not replace them. It also only
sees what is rendered, so collapsed resume sections and closed dialogs need
explicit expansion before scanning.

## Verification

| Claim | How it is checked |
|---|---|
| Contrast failures fixed | axe report before and after, both themes, all routes — the token table becomes zero violations |
| Nothing silently unverifiable | the `incomplete` list is reviewed item by item, not skimmed |
| Blog reads cleanly | computed styles re-probed: `listStyleType`, `paddingLeft`, `marginBottom`, `textAlign` — the same measurements that found the problem |
| Fixture exercises the audit | element counts on the kitchen-sink post are non-zero for link, image, list, blockquote, code, table |
| Nothing else broke | `yarn ci` green; existing `accessibility basics` e2e tests still pass |
| No PDF churn | `pdfs.spec.ts` stays green |

The last row is a tripwire, not a chore. `global.css` is **not** in
`FINGERPRINTED_FILES`, so none of this work should touch a fingerprinted file.
If `pdfs.spec.ts` goes red, scope has drifted into resume styling — stop and
reconsider rather than regenerating. Regenerating needs `CONTENT_SEAL_KEY` and
pulls in #49.

## Open questions

Named here so they surface as findings rather than surprises:

1. Whether `--color-tag`, `--color-emphasis` and `--color-disabled` are
   foregrounds or backgrounds at their real usage sites. This decides whether
   three of the six "fail" cells are real. axe settles it.
2. How much visual change `@tailwindcss/typography` brings to blog body text.
   The direction is right; the magnitude is unknown until it renders. If it
   moves further than "fix what is broken" allows, the fallback is overriding
   the plugin's type scale to hold current sizes.
3. Whether the missing `<h1>` on four route families should be fixed here or
   filed separately. It is a structural change across the site, which is wider
   than this spec's licence. Related: `content.spec.ts:78` only visits `/`, so
   widening that test's route coverage is the cheaper half of the fix and could
   land either way.

## Out of scope

- **#46, resume dark palette.** Every resume style file is in
  `FINGERPRINTED_FILES`, so each iteration forces unseal → `yarn resume:pdf` →
  commit. Blocked on #49 making that failure legible. Separate spec.
- **#52 and visual regression.** Screenshot assertions on a suite whose server
  dies mid-run turn one flake into dozens of diffs. Also, baselines captured
  before this restyle would all be discarded by it.
- **Typographic redesign.** Explicitly declined; the licence is corrective only.
- **A.I.R. issues #44, #45, #48.** Unrelated.
