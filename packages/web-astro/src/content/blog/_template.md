---
title: 'TEMPLATE — copy this file to write a post'
author: eddie-freeman
blurb: >-
  One sentence, for the listing card. It is also what A.I.R. searches: the
  blurb is mirrored into the retrieval index, so wording someone would
  actually type belongs here rather than a teaser that withholds the subject.
tags: ['example']
heroImage:
  url: '/blog-post.webp'
  alt: 'What the image shows, for someone who cannot see it.'
relatedPosts: []
draft: true
# publishDate: 2026-09-01T09:00:00Z
---

Copy this file to `src/content/blog/<slug>.md`. The filename is the URL, so
`shipping-fast.md` serves at `/blog/shipping-fast`. Set `draft: false` to
publish.

## The fields that are not obvious

**`author` and `relatedPosts` are validated references**, not free text.
`author` points at an entry in `src/content/authors/`, `relatedPosts` at other
posts by their slug. A typo fails the build rather than rendering a dead link,
which is the whole reason they are references.

**`tags` are how a question finds this post.** A.I.R. answers from published
posts, and it searches frontmatter only — the body never makes a post
*findable*, however good it is. Tag for what makes this post different: a term
carried by more than half the corpus is discarded as meaningless, so tagging
every post `engineering` makes `engineering` useless. Prefer the words a reader
would actually ask in.

**`heroImage.alt` is not optional.** It is what a screen reader announces.

## Publishing and scheduling

`draft: true` hides the post in production while leaving it visible on staging
and per-PR previews, so it can be reviewed at a real URL before it exists
publicly.

`publishDate` schedules it. Pages render per request, so the post appears the
moment the date passes — no cron, no rebuild, no deploy. Omit the field to
publish as soon as `draft` is false.

A post that is drafted *or* scheduled is also withheld from A.I.R. Answering
from a post the site refuses to serve would publish it early, in prose, to
anyone who asked the right question.

```bash
yarn posts:queue     # what is live, scheduled, and drafted
```

## Voice

`docs/VOICE.md` is the working definition — narrative first and insight
second, so the lesson is earned by the story rather than asserted ahead of it.
