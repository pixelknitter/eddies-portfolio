---
title: 'TEMPLATE — copy this file to add a project'
description: >-
  One sentence on what this is and the problem it solved. It renders on the
  card, and it is mirrored into A.I.R.'s retrieval index — so it should read
  like the answer to "what is this", not like a tagline.
image:
  url: '/project-card.webp'
  alt: 'What the image shows, for someone who cannot see it.'
worksImage1:
  url: '/detail-1.webp'
  alt: 'What this detail image shows.'
worksImage2:
  url: '/detail-2.webp'
  alt: 'What this detail image shows.'
platform: 'Web'
stack: ['TypeScript', 'React']
website: 'https://example.com'
github: 'https://github.com/pixelknitter/example'
tags: ['example']
draft: true
---

Copy this file to `src/content/projects/<slug>.md`. The filename is the URL, so
`curlfriend.md` serves at `/projects/curlfriend`. Set `draft: false` to publish.

## The fields that are not obvious

**`stack` is an array, not a joined string.** The page joins it for display, but
keeping the items separate is what lets anything else read them — the model
included. As a string it was skipped entirely when the prompt was assembled.

**`tags` are how a question finds this project**, and they are never rendered.
A.I.R. searches frontmatter only, so a good `description` alone does not make a
project findable. Two rules follow:

- Tag for what makes *this* project different. A term appearing in more than
  half the corpus is discarded as meaningless, so tagging every project `web`
  makes `web` useless.
- Use the words someone would ask in, which is not always the stack. "offline
  first", "payments", "accessibility" find a project that a framework name
  never would.

**Every image needs `alt`.** It is what a screen reader announces.

## The body

The body is the case study, in markdown — the problem, what you built, the
decisions and trade-offs, what came of it. It reaches A.I.R. as narrative
content once a question has retrieved the project, so it is worth writing even
though it plays no part in the retrieval itself.

## Publishing

`draft: true` hides one project; `PUBLIC_SHOW_PROJECTS` gates the whole
section. Both work by emitting no route at all rather than 404ing at request
time, because these pages are prerendered — a prerendered page would otherwise
sit on disk and be reachable by direct URL.

Drafts stay visible on staging and per-PR previews, so an unfinished case study
can be reviewed at a real URL before it is public.
