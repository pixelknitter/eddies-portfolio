---
title: 'TEMPLATE — copy this file to add a challenge'
situation: >-
  What went wrong, and what it cost. Name the failing plainly — a hedged
  situation ("the timeline proved ambitious") makes the whole entry unusable,
  because there is then nothing for the recovery to be a recovery from.
task: >-
  What getting out of it actually required of you. Your own remit, not the
  team's — the same rule as a highlight.
action: >-
  What you changed. Favour the decision you reversed, the assumption you threw
  out, or the process you rebuilt over a list of technologies.
result: >-
  The challenge overcome. A number if you have one, but the recovery itself is
  the line that carries this story — unlike a highlight, the outcome is allowed
  to be "it shipped, late, and nothing broke after".
reflection: >-
  What you carry forward. Optional, but this is the field a hiring manager is
  actually asking for: not what went wrong, but what you do differently now.
  One or two sentences.
tags: ['example']
draft: true
---

Copy this file to `src/content/challenges/<slug>.md`, fill in the fields, and
set `draft: false` to publish it.

## What this collection is for

Someone deciding whether to hire, contract or partner with you will ask about
gaps — and a decline reads as evasive on exactly the question where candour is
the differentiator. These entries are what let A.I.R. answer honestly instead.

Nothing renders them. There is no spotlight rotation, no page, no card. They
exist only in the corpus A.I.R. answers from, which is why they can be candid in
a way a landing page cannot.

## The body

The body is narrative — extra context that did not fit the five fields, in your
own words. It is read as content.

> **This differs from `star`.** A STAR body is an *honesty guardrail* — a rule
> about how a claim may be phrased ("reduces compliance risk, never guarantees
> compliance") — and it is hoisted outside the story tags as an instruction to
> the model. Here the body is just more of the story. Do not put rules in it.

## How A.I.R. is allowed to use these

It may draw a pattern across entries and cite them as the examples supporting
it. It may not turn one entry into a disposition.

- **Supported:** "When he has been wrong about a technical call, he has rewritten
  the approach rather than defended it" — with the entries cited.
- **Not supported:** "He underestimates timelines." No single entry supports a
  claim about how someone generally is, and a fabricated shortcoming is more
  damaging than a fabricated strength.

Write the entry so the first reading is available and the second is not. If a
story only supports the second, it is not finished.

## Before you publish

Consider sealing these. They are candid admissions about real projects, and by
implication real employers — the resume is sealed for less. Sealing is per-file
and retroactive, so it is not a decision you have to make while drafting:

```
node scripts/seal-content.mjs seal packages/web-astro/src/content/challenges/<slug>.md
```

The unsealed working copy then lives in `.local-challenges/`, which is
gitignored, and the build unseals to the real path.
