# The email relay harness: n8n owns transport

> **Status:** design approved in conversation (2026-08-03); written spec awaiting review
> **Date:** 2026-08-03
> **Enables:** [#83 automatic code emails](https://github.com/pixelknitter/eddies-portfolio/issues/83) — after this, #83 is an n8n workflow edit
> **Related:** [#82 guest analytics](https://github.com/pixelknitter/eddies-portfolio/issues/82), the 2026-08-02 value-first entry spec
> **Counterpart:** the n8n workflow and Twenty wiring live outside this repo; this document is the contract between the two sides

## Why

Access-request plumbing is scattered across bespoke integrations: the Worker
composes Discord embeds, renders an approval page, and sends email directly
through a `send_email` binding. Every new destination — a CRM record, a
different notifier, an automated grant — means another integration coded into
the Worker and another deploy.

Eddie runs n8n and Twenty. The relay moves orchestration there: the Worker's
entire email surface becomes two authenticated webhook legs, and destinations
change in n8n without touching this repo. Email — sending it, receiving it,
deciding what it says — becomes n8n's job entirely.

## The boundary

```
site ──(signed event)──▶ n8n ──▶ Discord ping / Twenty lead / email send
site ◀──(signed call)─── n8n     POST /api/relay/grant → { code }
```

- **Inbound email never reaches this repo.** Replies to `connect@` go to n8n
  through its own transport.
- **Twenty is invisible to this repo.** It is an n8n destination, nothing more.
- The Worker's contract with the outside world shrinks to: *emit request
  events, honor grant calls*.

## Outbound leg — the event

`request.ts` stops posting Discord embeds. On a validated access request it
POSTs one envelope to `RELAY_WEBHOOK_URL`:

```json
{
  "id": "<uuid>",
  "type": "air.request.received",
  "v": 1,
  "ts": 1754170000000,
  "data": {
    "email": "visitor@example.com",
    "reason": "the visitor's curiosity, verbatim",
    "approvalToken": "<signed, 7-day TTL>",
    "host": "eddie.engineering"
  }
}
```

- **Authentication:** HMAC-SHA256 over the raw request body, hex-encoded, in
  an `x-relay-signature` header, keyed by `RELAY_SIGNING_SECRET`. n8n verifies
  in a code node before acting. Same crypto family as `requests.mjs`; the
  helper is shared, not duplicated.
- **The token is the request.** `approvalToken` (existing
  `mintApprovalToken`, `APPROVAL_TTL_MS` = 7 days) carries the email and
  reason inside a signature, so the site stays storage-free. n8n holds the
  pending request; the token is what it holds.
- **Event types are namespaced** (`air.*`) so later flows — ratings, disputes,
  download requests, the deferred "full event bus" — are additive. `v` is the
  envelope version; bump it only for breaking shape changes.

## Inbound leg — the grant

`POST /api/relay/grant`, same HMAC scheme over the body, request body:

```json
{ "approvalToken": "<the token from the event>" }
```

Behaviour:

1. Signature invalid or missing → `401`.
2. Token invalid, tampered, or expired → `403` with a reason n8n can log.
3. Valid → `mintAccessCode(secret, email)` → `200` with
   `{ "code": "…", "email": "…" }`.

**Idempotent by construction:** the code mint is deterministic per email —
the property `approve.ts` already documents — so n8n retries are safe and no
grant state is stored. The approval *decision* lives wherever Eddie puts it in
n8n (a Discord button, a Twenty stage change); the site answers any
authenticated grant with a code and does not care what approved it.

## What gets deleted

| gone | replaced by |
|---|---|
| Discord embed composition + `DISCORD_ACCESS_WEBHOOK_URL` | the signed event; n8n pings Discord |
| `approve.ts` (GET approval page + direct email send) | approval affordance in n8n → grant call |
| `send_email` binding in `wrangler.jsonc`, the `EmailBinding` type | n8n's transport |
| notification/grant email templates in `email.mjs` | copy lives in n8n's sends |

Retiring `approve.ts` also retires the one GET endpoint that performs a side
effect — the link-preview-crawler caveat its own comments apologise for. The
grant is a POST behind HMAC, which is what it always wanted to be.

## Failure posture

Synchronous and honest, no queue: if the POST to n8n fails, the visitor gets
the existing *"Requests are not open right now. Try again later."* `503` —
identical to today's behaviour when the Discord webhook is down. Self-hosted
n8n becomes the availability bound for **new requests only**; asking questions
never touches the relay. Dead-lettering is deliberately out of scope — if n8n
uptime turns out to be a real problem, open an issue with data.

## Secrets

| name | used by | replaces |
|---|---|---|
| `RELAY_WEBHOOK_URL` | outbound POST target | `DISCORD_ACCESS_WEBHOOK_URL` |
| `RELAY_SIGNING_SECRET` | HMAC, both directions | — |

Set in the Worker environment per tier and in repo secrets for CI/e2e. One
secret for both legs: the parties are the same two systems, and two secrets
would double the rotation surface without separating any trust domain.

## Tests (representative)

- **Unit — new `relay.spec.ts`:** envelope signing round-trip; tamper
  rejection; grant handler: valid token → code, expired/tampered → `403`,
  same token twice → same code, bad signature → `401`.
- **Endpoint — `air.spec.ts` pattern:** a validated request POSTs an event
  whose signature verifies against the shared secret (mock sink); relay
  unreachable → `503` with the honest message.
- **e2e:** the local sink at `:4399` (currently impersonating Discord)
  becomes the relay sink. Add the round trip: submit request → sink captures
  the event → signed grant call → the returned code answers an ask.

## Sequencing and placement

- Implementation branch `feat/email-relay` off master, independent of the
  value-first gate work — the only shared file is `request.ts` and the
  changes compose.
- The n8n workflow (verify signature → Twenty lead → Discord ping → approval
  → grant call → send email) and Twenty wiring are built on Eddie's side;
  this spec is the interface.
- Cut-over is atomic per environment: the deploy that removes the Discord
  path is the deploy that starts posting to n8n, gated on the secrets being
  set in that tier first.

## Out of scope

- Ratings, disputes, download-request events (`air.*` names are reserved;
  see the "full event bus" option deliberately not taken)
- Dead-letter queues or Worker-side retry
- Automated approval — the decision stays human; this moves the plumbing
- Guest analytics ([#82](https://github.com/pixelknitter/eddies-portfolio/issues/82))
- The n8n workflow definition itself (lives with the n8n instance, not here)
