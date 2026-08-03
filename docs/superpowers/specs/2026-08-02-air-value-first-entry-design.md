# A.I.R. value-first entry: the guest token and the warm gate

> **Status:** approach approved in conversation (2026-08-02); written spec awaiting review
> **Date:** 2026-08-02
> **Depends on:** #81 (quality loop — ratings and disputes), then a rebase of #62
> **Tracked follow-ups:** [#82 guest analytics](https://github.com/pixelknitter/eddies-portfolio/issues/82), [#83 automatic code emails](https://github.com/pixelknitter/eddies-portfolio/issues/83)
> **Supersedes:** the "one field, two modes" gate in the 2026-07-31 spec — findings there still hold

## Why

The gate has been built twice and neither version leads with value. Code-first
put a password box in front of everything — the complaint the whole design
started from (2026-07-31 spec, finding 3). Question-first hid the box but still
answered a visitor's first move with a demand: state your question, now
authenticate. Both shapes spend the visitor's curiosity on the gate instead of
on the work.

Eddie's direction, verbatim: *"The main goal is to make it a clear UX — so WHY
should they ask questions might be the first step. A 'let me know what has you
curious' to get a code language."* And: give them *"a little something to show
them the value"* before asking for anything.

The résumé itself is already free — the code gates only `/api/air/ask`. So the
gate's job is not to protect the résumé; it is to decide when a stranger's
LLM spend becomes a conversation with Eddie. This design makes the first
question free, and makes the gate the *second* move — after value has been
demonstrated, phrased as an invitation rather than a challenge.

## The gate ladder

```
rung 0  no token, no code   → first ask answers immediately;
                              response mints guest token {spent: true, retried: false}
rung 1  guest token, spent  → warm access request, held question pre-seeded
        └─ negative rating  → re-mint {retried: true}: one more free ask
rung 2  access code         → unlimited asks (unchanged)
```

Server-side order in `/api/air/ask`:

1. Valid access code → answer. (Unchanged; codes always win.)
2. Valid guest token with headroom (`retried: true` grants one ask beyond the
   first) → answer, burn the headroom.
3. No token and no code → answer **and** mint a guest token into the response.
   This *is* the free question.
4. Spent guest token, no code → `403` with a body that names the request flow,
   so the client can open it rather than print an error.

A per-IP rate limit backstops the whole ladder. The guest allowance is a
doorbell, not a lock: clearing localStorage buys another free question, and
that is accepted — the access code itself is a shared string, and the repo's
posture everywhere is that the key is the gate, not the procedure.

## The guest token

A new purpose on the existing machinery in `requests.mjs` — no new crypto:

```
mintPurposeToken(secret, 'air-guest', { spent: true, retried: false })
```

- **TTL 7 days.** Long enough that a visitor who returns tomorrow is not
  quietly re-gifted; short enough that replay is bounded.
- Stored client-side alongside the access code, sent on asks as a header.
- **The retry re-mint** lives on the ratings endpoint (#81): a negative rating
  or dispute whose trace was guest-answered, arriving with a `retried: false`
  guest token, returns a `retried: true` token in the response. A
  `retried: true` token never re-mints — the worst case per guest is two LLM
  calls.

## The UX arc

Copy below is draft; Eddie's voice wins at implementation.

1. **Entry on `/cv/`** — the quick-ask trigger is unchanged and purely
   inviting. **The meter is never advertised**: leading with "1 free question"
   turns a gift into a paywall. The visitor discovers the gate only after
   they have received value.
2. **First ask** — just works, no ceremony. The answer renders with the
   quality-loop rating controls attached.
3. **Second ask, no code** — the field does not become a password box. The
   dialog swaps to the warm request: *"That first one was on the house. Want
   to go deeper? Tell me what has you curious and I'll open it up."* Email
   field, plus a reason field **pre-seeded with the question they just tried
   to ask** (editable). The Discord ping then carries their actual curiosity.
4. **The held question persists** to localStorage. When the visitor returns
   with a code and enters it, the question asks itself — the existing
   `heldQuestion` machinery, made persistent.
5. **Negative rating on the guest answer** — inline, at the rating controls:
   *"Let me take another run at that — ask again or rephrase."* The field
   reopens for the free retry.
6. **"Have a code?"** — a quiet link in the request view flips the field to
   code mode. The cold path exists for event handouts but is never the front
   door. Finding 3 stays honoured: nobody meets a password box before value.

## What gets deleted

The current primary no-code path — hold the question, demand a code, auto-send
— dies as the *default*. Holding survives in exactly two places: the
401-stale-code path (a rejected stored code re-asks for one, question held)
and the post-grant return (step 4 above). `askingForCode` mode becomes
reachable only through the explicit "Have a code?" link.

## Tests (representative, not incremental)

- **`requests.spec.ts`** — the `air-guest` purpose: mint → verify → tamper →
  expiry, and the upgrade rule: `retried: false` re-mints once on negative
  signal; `retried: true` never re-mints.
- **`air.spec.ts`** (endpoint order) — code beats guest; fresh visitor gets an
  answer *and* a token; spent guest gets 403 naming the request flow; retried
  guest gets exactly one more answer.
- **`AIResume.spec.tsx`** — rewritten around the arc, replacing the
  question-first gate tests: free first ask; second ask opens the warm
  request pre-seeded; negative rating reopens the field; code entry via the
  link; held question survives a reload (storage mock).
- **e2e `air.spec.ts`** — the code-seeding tests are replaced by the arc:
  free ask → gate → pre-seeded request; rating → retry; the "Have a code?"
  link. Every dialog open goes through `openDialog()` (see
  `support/dialog.ts` — geometry reads before the open animation settles are
  ~9px low and read as layout shifts).

## Sequencing

1. Land #81 (green, CLEAN).
2. Rebase #62 onto master. `AIResume.tsx` will conflict — the ratings UI
   meets the new dialog layout; reconciling them is the first task of this
   work, not an accident of it.
3. Build this design on the rebased #62 line.

## Out of scope

- **Guest analytics** — [#82](https://github.com/pixelknitter/eddies-portfolio/issues/82)
- **Automatic code delivery by email** — [#83](https://github.com/pixelknitter/eddies-portfolio/issues/83),
  blocked on the email harness (separate design)
- Advertising the allowance, KV-backed guest sessions, guest identity of any
  kind
- Expanded corpus content (projects, challenges, STARs) — Eddie's parallel
  workstream; lands as content, orthogonal to this flow
