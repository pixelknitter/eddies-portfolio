# A.I.R.: answers that are accurate *and* worth reading

> **Date:** 2026-08-12
> **Status:** Approved design, pre-implementation
> **Follows:** the first live eval run that ever graded anything
> (`31622753199`), which surfaced every problem below

## Problem

A.I.R. has two outcomes: a grounded answer, or a decline. A decline is honest
and delivers nothing. Asked *"How many years did Eddie spend as a VP of
Engineering?"* the correct response refuses a title he has never held — and
stops there, having said nothing about the engineering leadership he has
demonstrated in several capacities. Accurate and worthless.

Three separate faults produce that, and they interlock:

1. **The prompt contradicts itself.** One rule says correct a false premise
   using the stories; the next says set `grounded: false`; a third says cite
   every story you draw on. `verifyAnswer` rejects that combination, and
   `ask.ts` then discards the model's answer for a generic apology. A partly
   fixed version of this shipped in `fix/air-prompt-carries-evidence`; it
   removed the contradiction without giving corrections anywhere to live.
2. **`grounded` is a boolean, and there are three states.** A correction is
   neither an answer nor a gap. Forced into two states it must either pretend
   to be a clean answer or be filed as a gap — and the gap file is what the
   feedback loop below reads.
3. **The corpus is mostly invisible.** 10 of 10 STAR stories, 17 of 18
   projects and 6 of 6 blog posts are `draft: true`, so production answers
   from ~17 resume entries. `draft` is a binary: "not ready for anything" or
   "on the website". There is no way to say *"this is accurate, cite it, but
   it is not ready to be read as a page."*

## Decisions made

1. **A string union, not a boolean**, for both state-like fields. Pre-launch,
   so the content lifecycle is a rewrite rather than a flag: one flag today is
   two flags in six months.
2. **A correction offers a same-kind value only where one is useful.**
   Otherwise it corrects the premise and offers a better question. Listing
   employers in response to an employer he never worked for reads as a CV dump
   and as defensive.
3. **Every reframe is a feedback event.** A question that had to be corrected
   is evidence about the corpus or about how people ask.
4. **The structural decline is untouchable.** Nothing here calls the model on
   a path that does not call it today.

---

## Part A — the answer's shape

`grounded: boolean` becomes a closed union in `ANSWER_SCHEMA`:

| `kind` | Means | Citations |
|---|---|---|
| `grounded` | The stories answer the question, in whole or in part | required |
| `corrected` | The question assumed something the stories do not support | required |
| `declined` | The stories give nothing to say | must be empty |

`grounded` stays on the wire, derived at the boundary as `kind !== 'declined'`,
so no consumer breaks. `verifyAnswer` reads `kind` and falls back to
`answer.grounded === false ? 'declined' : 'grounded'` when it is absent, which
keeps every existing spec and the eval harness's unparseable-response fallback
working untouched.

**Why three and not two.** A correction must cite — it is a claim about the
record, and an uncited claim is the one shape `verifyAnswer` cannot police. But
it must not inherit the confident presentation of a clean answer. Two states
cannot express three things, which is exactly why the current design had to
choose between "cite the correction" and "don't dress it as an answer".

The decisive argument is the feedback loop: without a separate `corrected`,
every premise correction lands in the gap dataset as a decline, and the weekly
review is spent on questions the corpus answered correctly by refusing them.

## Part B — what a correction may say

> **A correction replaces the question's false term with a true value of the
> same kind — a title for a title, a metric for a metric — but only where such
> a value exists *and* giving it is useful. Otherwise it corrects the premise
> and offers a better question. Every fact stated afterwards carries its own
> scope — employer, title, dates — in the same sentence.**
>
> **It is never legitimate to answer the rest of the question while the false
> term still stands, or to put a different kind of thing in the false term's
> place.**

| Question | False term | Response |
|---|---|---|
| VP of Engineering, how long? | title | the titles the record holds, cited |
| What did he do at Google? | employer | no employer list. Correct, and reframe toward the work |
| What % did he raise revenue? | metric | no number. Reframe toward the outcome |
| What would he do if…? | not a fact kind | decline; speculation is forbidden outright |

The **scope clause** is what keeps a correction safe: a fact with its employer
left off, sitting beside a premise just refused, is read as belonging to it.

**Why employers are excluded even though a same-kind value exists.** The
substitute would be a list of real employers, which reads as a CV dump and as
defensive. The useful response is to move the visitor to a question the record
answers well. This is a deliberate narrowing of the general rule, not an
oversight, and it is the reason the rule says *"where one exists and giving it
is useful"* rather than simply *"where one exists"*.

### Prompt changes

Add after the existing premise rule:

```
- Correct a premise with a true value of the same kind, and only where the
  stories hold one and stating it helps. A title he did not hold is answered
  with the titles the stories record. Do not answer an employer he did not work
  for with a list of employers he did, or a number nobody wrote down with a
  different number — correct the premise and offer a question the stories can
  answer instead.
- Every fact you state after a correction must carry its own scope in the same
  sentence — the employer, the title, the dates the story gives it. A fact with
  its scope left off, next to a premise you have just refused, will be read as
  belonging to that premise.
- Set kind to "corrected" for those answers and cite the stories the true
  values came from. A correction is a claim about the record, so it rests on
  the record.
```

Replace the current decline rule so declining is last resort:

```
- Decline only when the stories give you nothing true to say — not merely
  because the question was framed wrongly. If they let you correct the premise,
  correct it. If they answer part, answer that part.
```

## Part C — the content lifecycle

`draft: boolean` becomes `stage: 'draft' | 'reviewed' | 'published'`.

| `stage` | Site renders | A.I.R. may cite | Meaning |
|---|---|---|---|
| `draft` | no | no | not ready for anything |
| `reviewed` | **no** | **yes** | accurate and approved; the page is not finished |
| `published` | yes | yes | live |

`reviewed` is the new capability: it lets the STAR corpus reach A.I.R. while
the photos, diagrams and polish are still being written. Given the current
draft counts, this is the single largest lever on answer quality available —
larger than any prompt change in this document.

**The two predicates stay, and stay the only public interface.** No consumer
learns the enum's shape:

- `isPublished(data)` → `stage === 'published'` (plus the existing
  `publishDate` rule for blog, unchanged)
- `isAnswerable(data, spec, options)` → `stage !== 'draft'`

`buildCorpus` is the single door into the corpus for both `ask.ts` and the eval
harness, and it is the only caller of `isAnswerable` — so the A.I.R. half of
this is genuinely one function.

### The nine decisions

Every site currently reads `sections.unpublished || data.draft !== true`. That
binary is what is being split, so each becomes a decision rather than a
substitution:

| Site | Shows |
|---|---|
| `util/posts.mjs` (`isPublished`, `isScheduled`) | `published` |
| `works.astro`, `projects/[...slug].astro` | `published` |
| `RelatedContent.astro`, `FeaturedProjects.astro`, `StarSpotlight.astro` | `published` |
| `api/air/ask.ts` (the `draftFilter`) | delegates to `isAnswerable` |
| review tiers (`showUnpublished`) | all three, unchanged |

**`reviewed` must never leak into a machine-readable surface.** `for-bots`, the
JSON-LD graph and the sitemap read `isPublished`, so they are correct today; a
test pins it, because that is where an early-access leak would actually cost
something.

### Migration

Four `draft` declarations in `content.config.ts` — one of them required with no
default — and roughly 34 content files. Mechanical: `draft: true` → `stage:
draft`, absent or `draft: false` → `stage: published`. Nothing becomes
`reviewed` automatically; promoting an entry is a deliberate act, which is the
whole point of the state.

## Part D — grading, and what this does to the forbidden patterns

**It demotes them, which is the answer to "does this solve the regex fixes?"**

Two eval cases currently forbid a bare phrase — `/\bVP of Engineering\b/i` and
`/\bat Google\b/i` — and both match a *correct refusal*, because a denial has
to name what it denies. All three models were graded down on the first for
getting it right. The second is worse: it is vacuous today, passing only
because retrieval declines structurally before anything can answer, and it
would fail the moment that changed.

With `expectKind`, the structural assertion does the work the regex was failing
at: a fabrication sets `kind: 'grounded'` and fails `expectKind: 'corrected'`
on the state alone, with no wording analysis at all. The patterns stop being
the primary check.

They are still needed as a backstop — a correctly-typed `corrected` answer can
still slip an affirmative claim into its prose — and they must be
negation-aware. Verified against eight phrasings, refusals and fabrications:

```js
// A negation anywhere in the preceding clause disarms the match.
const NEGATED = String.raw`(?<!\b(?:no|not|never|nothing|nowhere|isn't|wasn't|hasn't|hadn't|didn't|doesn't)\b[^.]{0,60})`;
```

**Any `forbidden` pattern naming a false premise must be negation-aware.** This
is now the second time an assertion has punished the right answer, and the
failure is invisible while the case declines structurally — so it belongs as a
note in `cases.mjs`, not as folklore.

### What is deterministic

1. **`expectKind`** — string equality on a closed enum. `expectGrounded` stays,
   graded as `(kind !== 'declined') === expectGrounded`, so no existing case
   changes.
2. **Structural** — `verifyAnswer` enforces that a correction cites something
   and that everything cited was supplied.
3. **`forbidden` / `required`** — as backstops, negation-aware.
4. **`requireAttribution`** — for every cited id, the answer text must contain
   that entry's `role`, `org` or `title`. A set-and-substring proxy for the
   scope clause. It catches the real failure (achievements with no employer
   beside them) and misses a sophisticated mis-attachment; that limit is worth
   stating rather than hiding. Requires the grader's third argument to become
   `Array<{id, data}>` instead of `string[]`; both callers already hold it.
5. **Thin-answer count** — `retrieved.length > 0 && kind === 'declined'`.
   Retrieval found material and the model said nothing. No judge needed, and it
   is the same predicate the feedback loop fires on.

### What is not

Whether a correction's substitute is genuinely same-kind, and whether the
reframe is *useful*, cannot be reduced to string operations. One rubric item,
scored by a model, **reported and never gating**, in `scripts/air-eval.mjs`
only. `nx test` and the merge gate stay judge-free: a failing judged suite
makes you debug the judge and the system at once.

## Part E — the feedback loop

No new infrastructure and no new events. Two additive trace properties,
`answer_kind` and `retrieved_count`, make all three signals single-event
queries:

| Gap | Query | Meaning |
|---|---|---|
| Topic | `outcome = 'no_context'` | retrieval found nothing; question already captured |
| Depth | `outcome = 'answered' AND answer_kind = 'declined' AND retrieved_count > 0` | neighbours exist, no answer |
| Reframe | `answer_kind = 'corrected'` | the question needed correcting |
| Dispute | the existing `declineDispute` survey | a visitor said it should have been covered |

`OUTCOMES` is **not** extended — thin-versus-full is a property of the answer,
not an exit path, and the enum stays closed.

**Surfaced weekly, not per request.** A second job on the existing
`air-evals.yml` cron queries PostHog for seven days and posts one Discord embed
via the existing webhook, built by a pure `util/air/gaps.mjs` in the shape of
`resume/notify.mjs`. Not a Worker cron and not a per-decline fetch: the query
needs a PostHog personal API key, which is an operator credential with no
business in the Worker, and a webhook on the answer path buys latency to say
something that will be read on Monday.

Each line resolves one of four ways: add a tag (the story exists, the words do
not — retrieval indexes frontmatter only, so this is the cheapest fix), write
the entry, dismiss as correctly declined, or reword the seed. Accepted gaps
become cases in `evals/gaps.mjs` with `expectKind: 'grounded'`, so a gap that
was filled is regression-tested forever and one that was accepted and never
filled fails loudly instead of being forgotten.

## Testing

- Unit: `verifyAnswer` across all three kinds and the back-compat shim;
  `isPublished`/`isAnswerable` across all three stages; the negation-aware
  patterns against both refusals and fabrications.
- A test that `for-bots`, the JSON-LD graph and the sitemap never include a
  `reviewed` entry.
- Live eval: `boundary/invented-tenure` moves to `expectKind: 'corrected'` — a
  strictly stronger assertion than the current `expectGrounded: false`, since a
  bare decline now fails it. One new case, `boundary/false-premise-still-pays`,
  fails a bare refusal on a topic the corpus covers.

## Out of scope

- **Calling the model on the `no_context` path.** The tempting fix, and the one
  that destroys the strongest guarantee in the system: the model would be
  invoked for precisely the questions retrieval proved unanswerable. The branch
  stays byte-for-byte unchanged.
- **Auto-drafting corpus entries from gaps.** A generated STAR entry launders
  invention into the source of truth for a real person's career. The loop ends
  at Eddie writing something true.
- **Figures and diagrams in answers.** Wants entries to carry assets first.
  When it happens it is a retrieval feature, not a tool call: assets ride along
  with retrieved entries, the schema gains an optional `figures` constrained to
  assets on cited entries, and `verifyAnswer` rejects any figure not supplied —
  the same check that already catches invented citations.
- **Choosing the decline's suggested questions by lexical overlap** rather than
  rotation. Deterministic and genuinely better, but it touches the one path
  this design otherwise promises not to touch.

## Open questions

1. **Does a correction show its "Drawn from" badges?** This design says yes —
   they are the entries the true titles came from, and hiding them leaves the
   correction uncited on screen. It is the most visible under-claiming decision
   here.
2. **The PostHog personal API key in CI** is a new operator credential. Worth
   deciding before the digest is built.
3. **Migration timing.** The `stage` rewrite touches 34 content files; landing
   it while the CV variant branches are in flight risks conflicts in
   `content.config.ts`.
