---
title: 'SAMPLE — Markdown kitchen sink'
blurb: 'Fixture exercising every element the blog can render, for the accessibility audit'
author: eddie-freeman
tags: ['sample', 'accessibility']
heroImage:
  url: '/blog-post.webp'
  alt: 'A raccoon working at a laptop, the blog section illustration'
relatedPosts: []
publishDate: 2024-01-01T09:00:00Z
draft: false
---

This post exists so the accessibility audit has something to look at. axe can
only check elements that are actually on the page, so a scan against a post
containing two paragraphs and one list comes back clean by having nothing to
examine — which reads as a pass and is not one.

Everything below is deliberately *correct*: the alt text describes the images,
the links say where they go, and the headings descend in order. That matters,
because this page is the baseline. Any violation the audit reports against it
is a theming or styling bug rather than a fault seeded in the content, and a
fixture with deliberate faults would make the audit permanently red — which is
the fastest way to teach everyone to ignore it.

## Paragraphs and inline formatting

A paragraph long enough to wrap several times, so the measured line length,
the line height and the text alignment are all visible on a rendered page
rather than inferred from the stylesheet. Justified text with manual
hyphenation can only pad the spaces between words, which opens rivers of
whitespace down a narrow column — the kind of thing that is obvious at this
length and invisible in a single short line.

Inline formatting: some **strong emphasis**, some *ordinary emphasis*, and a
piece of `inline code` that should keep its monospace face and stay legible
against the page in both themes.

### Links

An [internal link to the works index](/works/) and an
[external link to the Astro documentation](https://docs.astro.build) — both
phrased so the link text alone says where it leads, rather than "click here".

## Lists

An unordered list:

- Bullets need `list-style` and `padding-left`, both of which Tailwind's
  preflight removes.
- The typography plugin is what restores them.
- Without a `.prose` ancestor, these render as unmarked, unindented lines.

An ordered list:

1. First, the audit measures.
2. Then the tokens change.
3. Then the audit measures again.

A nested list, because nesting is where indent rules usually break:

- Themes
  - Light
  - Dark
- Routes
  - Index pages
  - Detail pages

## Blockquotes

> A quotation, set apart from the body text by its own indent and rule.
>
> > And a nested quotation inside it, which needs its own visible step or the
> > two levels collapse into one.

## Code

A fenced block with a language, so syntax highlighting and horizontal overflow
both get exercised:

```ts
export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}
```

## Images

![A stylised illustration used as the first sample project's cover art](/image-1.webp)

Images need intrinsic sizing that does not overflow a narrow viewport, and alt
text that describes them rather than naming the file.

![A stylised illustration used as the second sample project's cover art](/image-2.webp)

## Tables

Tables are the element most likely to overflow on a phone, and the one most
often shipped without a header row:

| Token | Light ground | Dark ground | Verdict |
| --- | --- | --- | --- |
| `--color-link` | 1.63 | 8.81 | fails on light |
| `--color-underline` | 3.44 | 4.17 | large text only |
| `--color-tag` | 7.17 | 7.17 | carries its own background |

## Headings, all the way down

The remaining levels exist so the outline check has something to descend
through without skipping.

#### Fourth level

Content under a fourth-level heading.

##### Fifth level

Content under a fifth-level heading.

###### Sixth level

Content under a sixth-level heading.

---

A horizontal rule sits above this line, which is the last element the audit
needs to see.
