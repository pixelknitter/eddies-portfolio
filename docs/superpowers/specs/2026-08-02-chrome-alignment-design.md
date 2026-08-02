# Aligning the site chrome to the artwork palette

> **Status:** implemented and verified
> **Date:** 2026-08-02
> **Depends on:** #71 (solarpunk light / space dark palette)
> **Deliberately excluded:** `--color-emphasis`, the pink brand SVGs — see [Out of scope](#out-of-scope)

## Why

#71 moved the page ground to sunlit paper and gave the résumé a palette where
every slot carries a light value and a dark value with the same meaning. The
site chrome did not follow. On the new ground the badges read as holes punched
in the page.

The obvious diagnosis — "the violet fails contrast on paper" — is wrong, and
acting on it would have produced the wrong fix. Pale text on the violet measures
**7.65:1**. It passes AA comfortably.

The failure is one of **weight**. Measured against its own ground:

| | vs its ground |
|---|---|
| badge in dark mode | 2.00:1 — a quiet chip, gently raised |
| badge in light mode | 7.65:1 — a slab as loud as body text |

One element cannot mean "incidental metadata" at both weights. On paper the loud
reading won, so a tag shouted louder than the heading beside it.

## Decision: two voices, one weight

The site keeps violet and teal as its own personality — they belong to the
raccoon artwork's planets, and #71 deliberately retained teal as the heading
underline. Only the weight is corrected, and **dark mode is untouched**.

Rejected: moving the chrome to the résumé's terracotta/mint. It would have made
the two surfaces one system, but at the cost of the site's own character, to fix
a problem that is about weight rather than hue.

## Findings

### 1. `.badge` is two jobs under one name

`Badge.astro` puts `class="badge"` on an `<Image>` for the tech-stack tiles.
Astro's scoped style only *adds* `rounded-md p-1.5`; the global `.badge`
(`bg-tag text-light`) still applies. The violet squares behind the tech icons
are a name collision, not a design choice.

This matters because the two want opposite things on paper. A pill must recede
behind dark text. A tile must guarantee an arbitrary vendor mark reads.

### 2. Three brand marks depend on the tile being dark

`public/brand/anthropic.svg`, `openai.svg` and `modelcontextprotocol.svg` are
hand-inked `#FDEBF3` — the pink page ground #71 retired. They are legible only
because something dark sits behind them.

| tile | those marks measure |
|---|---|
| dark violet, today | 7.17:1 ✓ |
| paled to match the pill | 1.11:1 ✗ |

WCAG 1.4.11 asks 3:1 of icons. Paling the tile with the pill would have made
three logos invisible — a defect introduced by a change intended to improve
legibility, and one that no amount of looking at the CSS would have predicted.

### 3. `index.astro` had hand-copied the badge

Line 19 repeated `bg-tag text-light rounded-md font-body font-semibold …`
inline rather than using the class, differing only in font size (`0.85rem`
against `text-sm`'s `0.875rem`) — a gap too small to be deliberate.

A copy does not follow its original. The page showing the most pills would have
kept the dark fill.

### 4. Footer links fail AA on every page

`Footer.astro` used the bare `text-link`, which is mint.

| | light mode |
|---|---|
| `text-link` | **1.74:1** ✗ (AA needs 4.5) |
| `text-link-on-light` | **5.70:1** ✓ |

The footer is in the base layout, so this ships on every route. `--color-link-on-light`
was added in #59 for exactly this, and its own comment in `global.css` names
`Footer.astro` as the motivating case. The token then landed in `LatestWork`,
`404` and `Prose` and never came back to the file it was named after.

This is not a theming preference. It is a live accessibility defect, and it is
the most urgent item here.

## Design

### `--color-tag` gains a light-mode pair

```css
--color-tag: #584966;          /* unchanged — dark mode */
--color-tag-on-light: #dcd1e5; /* hue 271°, saturation raised to survive the tint */
```

Chosen by measurement, not by eye. Tinting `--color-tag` toward the paper ground
hits the target weight at `#d9d0cf`, but mixing a low-saturation violet into warm
paper drains the violet out and leaves a taupe grey. Holding the hue at 271° and
raising saturation keeps it recognisably the same colour.

| | vs paper | ink on it |
|---|---|---|
| `#dcd1e5` | **1.37:1** | **11.16:1** |

1.37:1 is the weight `--color-surface-dark` already carries in dark mode
(1.42:1), so the pill reads as the same kind of object in both themes.

The pill gets quieter *and* its label gets clearer. Those normally trade against
each other; here they do not, because the two numbers measure different pairs —
pill-vs-page is hierarchy, ink-vs-pill is legibility. Lightening the fill lowers
the first and raises the second. The old design coupled them by making the fill
dark *and* the text pale.

### `.tech-tile` splits out of `.badge`

```css
.badge     { @apply bg-tag-on-light text-dark dark:bg-tag dark:text-light …; }
.tech-tile { @apply bg-tag rounded-md p-1.5; }
```

`.tech-tile` is deliberately dark in **both** themes, so no brand SVG needs
re-inking. `Badge.astro`'s scoped rule keeps only the motion, which is specific
to the floating icons; fill and padding come from the global class.

### Two drift fixes

- `index.astro` uses `class="badge"`.
- `Footer.astro` uses `text-link-on-light dark:text-link`.

### `body` loses `text-justify`

Justification without hyphenation buys even margins by paying in uneven word
spacing. At `max-w-screen-md` — roughly 80 characters — that showed as rivers,
clearest in the home page's "My Building Blocks" copy.

`Prose.astro` already overrode this with `text-left` for blog and project
content, which is the tell: the rule was being worked around wherever anyone
looked closely at the typography. Removing it makes that override redundant
rather than load-bearing.

## Verification

Measured from the committed token values, and rendered against a real Worker in
both themes at every route — not inferred.

| Claim | How it was checked |
|---|---|
| The badge reads as a chip, not a slab, on paper | 7.65:1 → 1.37:1 against the ground |
| Its label stayed legible | 7.65:1 → 11.16:1 |
| Dark mode is untouched | badge still 2.00:1; dark screenshots identical but for the ragged-right copy |
| Brand marks still read | tiles stayed dark; marks hold at 7.17:1 |
| Footer links reach AA | 1.74:1 → 5.70:1, on every route |
| No component was missed | no bare `bg-tag` or `text-link` remains outside `global.css` |
| The résumé PDFs are unaffected | `global.css` is not fingerprinted; `pdfs.spec.ts` green, including `matches the sources it was generated from` |
| Nothing else broke | `yarn ci` green — 271 passed, 0 failures, `astro check` 0 errors |

The PDF row is a tripwire. If it goes red, the work has drifted into a
fingerprinted file and should stop rather than regenerate.

## Out of scope

- **`--color-emphasis`.** Measures 7.02:1 on the new ground, so it is not
  broken. It is also used in `ResumeFull.astro`, which is fingerprinted, so
  changing it would force a PDF regeneration to buy nothing.
- **The three `#FDEBF3` brand SVGs.** They keep the retired pink. Since the
  tiles stay dark they still read at 7.17:1, so this is recorded as known debt
  rather than fixed: it is now the last place that colour survives, and it will
  become live again if anyone ever pales `.tech-tile`.
- **Moving the chrome to the résumé palette.** Considered and rejected above.
