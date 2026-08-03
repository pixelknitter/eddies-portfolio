# A.I.R. as a feature of the CV

> **Status:** approved, not yet implemented
> **Date:** 2026-07-31
> **Depends on:** #60 (the `/cv` route move), #62 (A.I.R. reframed as a CV feature)
> **Deliberately excluded:** event-scoped access codes, post-answer lead capture — see [Out of scope](#out-of-scope)

## Why

A.I.R. reads as a separate product that happens to live near the résumé. It has
its own page, its own greeting, and its own front door. The résumé, meanwhile,
scatters its controls across three places and asks every visitor to look at a
password box before it shows them anything.

Two goals: make A.I.R. legible as a *feature of the CV*, and put each control
next to the thing it acts on.

## Findings

Measured on a Pixel 7 viewport against a real Worker, not inferred.

### 1. Controls sit far from what they control

| control | y | what it acts on | y |
|---|---|---|---|
| `Expand all` | 167 | first collapsible section | 795 |
| action bar (`Ask A.I.R.`, `Complete version`) | 544 | — | — |

`Expand all` is **628px above** the first thing it expands, and above the résumé
card entirely — so it offers to expand something the visitor has not yet seen.

The action bar sits *inside* the card, between the badges and the metric cards.
At that width its pills stack and inherit the card's body rhythm, so they read
as prose with borders rather than as things to press. The vocabulary is right;
the container is wrong.

### 2. Two machine-readable things, two places, confusable

`Bot readable` (a PDF download) sits at the top. `Complete version, for
machines` (the HTML page at `/cv/for-bots`) sits mid-card. They sound like the
same thing and are not.

A human does not need either as a link — the PDF is a download, and the HTML
page exists for machines. But that visible link is currently the **only**
in-page pointer to `/cv/for-bots`; removing it without replacement leaves the
page reachable by crawl alone.

### 3. The access code is asked for first and forgotten immediately

`AIResume.tsx:33` holds the code in React state and nothing else. It is not
persisted, so it is lost on every reload — a visitor who returns to the page
retypes a conference code they already used. Meanwhile the field is rendered
unconditionally, so the first thing anyone sees is a password box.

Feedback from the event: the code is too long to hand out comfortably. That is
addressed separately; see [Out of scope](#out-of-scope).

### 4. The access code does not gate the PDF download

Worth stating because it is easy to assume otherwise, and the assumption would
put an access-code field in front of a flow that does not read one.

| surface | gate | issued by |
|---|---|---|
| `/api/air/ask` | `AIR_ACCESS_CODE`, sent as `x-air-access` | handed out by Eddie |
| `/api/resume/download` | a signed token, `verifyPurposeToken` | `/api/resume/request`, which takes an **email and a reason** |

`ResumeDownload.tsx` never sends an access code. The download path is *address →
signed links → watermarked bytes*, and the watermark comes from the token rather
than the query. The two gates are independent and stay that way.

## Design

### `/cv/` layout

```
[⤓ Human readable]  [⤓ Bot readable]
[ Ask A.I.R. about Eddie's work…             ]   ← a trigger, not a text field
────────────────────────────────────────────────   ← A.I.R. off: this row absent
┌ Eddie Freeman · Senior Product Engineer …
│ summary · [Portland, OR] [Open to senior / staff roles]
│ [15+ years] [2 tiles]
│ [ Expand all ]
│ ● What I'm good at                        ⌄
│ …
│ [ Collapse all ]
```

The quick-ask row renders **only when A.I.R. is on**. With it off — production,
today — the top zone is the two download buttons and nothing else. The download
island keeps its own address flow untouched; nothing about downloading moves
into this input, because the two gates are independent (finding 4).

Three moves:

- **`Expand all` drops** to below the metric cards and above the first section
  header, beside what it expands — and a matching **`Collapse all` appears at
  the foot** of the sections, for someone who has read to the bottom and wants
  to fold it back up without scrolling to the top. Both are excluded from print:
  they toggle `<details>` elements that print open regardless, so on paper they
  are two dead buttons.
- **The A.I.R. quick-ask control takes the top slot**, where `Expand all` was.
  It is the feature's front door rather than a line buried mid-card.

  It is styled as an input but is **not a text field** — it is the modal
  trigger, and focusing it opens the dialog. Stated explicitly because the
  alternative reading (type here, press enter, then the modal opens) means a
  visitor's first keystrokes land in a control that is about to be replaced,
  and the text has to be carried across. One input that accepts text lives in
  the modal; this one only opens it.
- **`ResumeActions` dissolves.** A.I.R. moves up; the machine-readable link
  becomes `<link rel="alternate" type="text/html" href="/cv/for-bots">` in
  `<head>` — invisible to people, still a pointer for anything parsing the page.

`ResumeVisual.astro` is not touched. It is fingerprinted, and everything here
lives in the page or in non-fingerprinted components, so no PDF regeneration is
needed. That is the whole reason the action bar was extracted in #60.

### The modal

Opens when the quick-ask input is **selected** — focus, not submit. A visitor
who clicks the input is already asking; making them press enter first to reach
the real input is a step that buys nothing.

**One input, two modes**, keyed on whether a code is stored:

| stored code | placeholder | accepts |
|---|---|---|
| none | `Enter your access code` | the code |
| present | `Ask about Eddie's work…` | questions |

The placeholder is what signals the shift; there is no second field and no
mode toggle. The separate "Access code" input is removed.

Below the input — **in the modal, not on the page** — `Don't have a code? Ask
Eddie for access` links to the existing request flow. It hides once a code is
stored, so a returning visitor never sees the access machinery at all.

It belongs here rather than on `/cv/` because this is where a code is actually
needed, and because "hides when one is stored" only reads correctly next to the
field whose mode it describes. Putting it in both places would state the same
condition twice and let the two drift.

### Shape and motion

```
┌─ overlay: shadowed backdrop ──────────────┐
│  ┌─────────────────────────────────────┐  │
│  │ input                               │  │
│  ├─────────────────────────────────────┤  │
│  │ suggestions  ⇄  answer              │  │
│  │ (one container, min-height fixed)   │  │
│  └─────────────────────────────────────┘  │
└───────────────────────────────────────────┘
```

The dialog **lifts** into place — rising a short distance while fading, over a
shadowed backdrop, so it reads as coming forward from the page rather than
appearing on top of it.

Two regions, not three. The input sits above **one** container that holds either
the suggestions or the answer: picking a suggestion or submitting a question
swaps the contents of that same box. There is no separate answer panel.

That container carries a **min-height sized to the suggestions**, so the swap
does not resize the dialog under the reader's cursor. Sized to the three
suggestions that exist today; see [Open questions](#open-questions) for the
fourth.

It also carries a ceiling. A long answer with sources grows the container until
it reaches the available screen height, and then the container **scrolls
internally** rather than growing further. Floor and ceiling on the same box:
`min-height` fits the suggestions, `max-height` is bounded by the viewport, and
`overflow-y: auto` covers the span between.

**The input does not scroll away.** Only the lower container scrolls, which is
the reason the dialog is two regions rather than one scrolling column: someone
reading a long answer can ask the next question without scrolling back up to
find the field. Background scroll is already locked while the dialog is open, so
there is exactly one scrollable region on screen and no ambiguity about which
one a wheel gesture drives.

Suggested questions render from `SUGGESTED`, as today.

The code persists to `localStorage`. **This is per-device convenience, not a
credential store**: it is a shared code, already sent from the browser on every
ask as `x-air-access`, and readable by any script on the origin. Persisting it
does not change what is exposed; it changes how often it is retyped.

### What the modal must do to count as a dialog

Named here because a modal without these is unusable by keyboard and absent to
a screen reader, and because they are easy to leave for later and never do.

- Focus moves into the dialog on open and is trapped while it is open.
- `Escape` closes it. Focus returns to the input that opened it.
- `role="dialog"`, `aria-modal="true"`, labelled by its heading.
- Background scroll is locked while open.
- The open/close animation respects `prefers-reduced-motion`. `AnimateOnScroll`
  ignored that query and produced both an unwanted fade and unstable contrast
  measurements; this does not repeat it.

### No JavaScript

The top input is a real link to `/cv/air/`, which JavaScript upgrades into a
modal trigger. Without JS a visitor follows the link and gets the existing page.

`/cv/air/` is retained for exactly this, plus direct links and sharing. Both
surfaces render the same island, so there is one implementation.

## Verification

| Claim | How it is checked |
|---|---|
| Controls sit beside what they act on | re-measure `Expand all` and the first section on a Pixel 7 viewport; the gap closes from 628px |
| The résumé card carries no action links | no `.resume-actions` in the rendered card |
| The quick-ask row is absent when A.I.R. is off | build with `PUBLIC_SHOW_AIR` unset; the top zone renders two download buttons and nothing else |
| Expand/Collapse do not reach paper | neither control appears in the generated PDFs |
| The dialog does not resize on first answer | measure the container before and after an answer replaces the suggestions |
| A long answer scrolls rather than overflowing | on a Pixel 7 viewport, render a long answer; the dialog stays within the screen, the container scrolls, and the input stays visible |
| `/cv/for-bots` stays discoverable | `<link rel="alternate">` present in `<head>`; route still 200s |
| The modal is operable by keyboard | tab into the input, `Enter`, tab through the dialog, `Escape`, focus lands back on the input |
| The code survives a reload | set a code, reload, confirm the placeholder is the question form and the request link is hidden |
| No JS still reaches A.I.R. | load `/cv/` with JavaScript disabled; the input is a link to `/cv/air/` |
| Nothing else broke | `yarn ci` green; `pdfs.spec.ts` stays green, proving no fingerprinted file was touched |

The last row is a tripwire. If `pdfs.spec.ts` goes red, the work has drifted
into `ResumeVisual.astro` and should stop rather than regenerate.

## Open questions

1. **The fourth suggestion.** The intent is one per audience with at least four
   audiences; there are three seeds today — Hiring manager, Client, Partner. A
   fourth is blocked, not merely unwritten: `suggested.mjs` records that every
   entry is a promise `offline.spec.ts` asserts retrieves context, and the live
   eval currently scores grounding 0/2. Adding one now would either fail the
   build or publish a promise the corpus cannot keep.

   Shipping at three, sized to three. The container grows when a fourth is
   earned. Worth revisiting the moment the retrieval work lands, because this is
   the third thing today to queue behind it — the A.I.R. content layer is the
   bottleneck, not the interface.

*(Resolved: the answer container grows to the available screen height and then
scrolls internally — see [Shape and motion](#shape-and-motion).)*

## Out of scope

- **Event-scoped access codes.** `AIR_ACCESS_CODE` is a single shared secret
  compared with `safeEqual`. Per-event codes ("Chain React 2026") are a shape
  change, and the code doubles as attribution for whatever lead capture follows
  — so the two belong in one spec, not bolted onto this one.
- **Post-answer lead capture.** Agreed shape: a soft gate after N free answers.
  Depends on the code work above, since the event is what a captured lead would
  be attributed to.
- **The suggestion seeds.** `suggested.mjs` documents that every entry is a
  promise `offline.spec.ts` asserts, and the live eval currently scores
  grounding 0/2. Adding seeds now would either fail the build or publish
  promises the corpus cannot keep. Blocked on the retrieval work.
- **A.I.R. as a rich search surface.** A larger product idea; this spec makes it
  a feature of the CV, which is the prerequisite either way.
