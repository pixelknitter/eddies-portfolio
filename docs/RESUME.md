# The resume

Four surfaces, one source of truth, and a download gate that captures leads.

| Route | What it is | Flag |
|---|---|---|
| `/air/resume/` | Visual resume, sections collapsed, no contact details | `PUBLIC_SHOW_RESUME` |
| `/air/resume/for-bots` | Complete resume + JSON-LD `ProfilePage` graph | `PUBLIC_SHOW_RESUME` |
| `/air/resume/print/human` | Print source for the human-readable PDF | `PUBLIC_RESUME_PRINT` |
| `/air/resume/print/bot` | Print source for the ATS/LLM PDF | `PUBLIC_RESUME_PRINT` |
| `POST /api/resume/request` | Lead capture; returns signed download links | `PUBLIC_SHOW_RESUME` |
| `GET /api/resume/download` | Serves a watermarked PDF against a token | `PUBLIC_SHOW_RESUME` |

Everything renders from `src/util/resume/resume.data.ts`. Prose carries `**bold**`
markers, converted by `util/resume/markup.ts` — the data holds no HTML.

## Why the resume has its own flag

A.I.R. is deliberately held back: `deploy.yml` sets no `PUBLIC_SHOW_*` in production
because the chat "is not ready to be found". The resume wants the opposite — it
carries a JSON-LD graph and a per-tier `robots.txt` specifically so it *is* found.
Sharing a flag would mean the resume could never go live without exposing the chat.

Staging and per-PR previews set `PUBLIC_SHOW_RESUME=true`. Production does not yet.

## Contact details

`RESUME` contains no email address and no phone number, and a spec asserts it by
pattern over every reachable string — so a new field with an address in it fails the
build rather than shipping. `Footer.astro` also swaps its `mailto:` for a link to the
request form on resume routes, decided from the pathname so a future resume route
inherits it.

Contact lives in a separate `CONTACT` export imported by exactly one component,
`PrintContact.astro`. If that component ever appears in a route serving the public
web, it is visible in an import list.

## Regenerating the PDFs

```bash
yarn resume:pdf              # both variants
yarn resume:pdf --only human
yarn resume:pdf --keep-pdf   # also write the raw files for inspection
```

Commit `src/util/resume/pdfs.generated.mjs` afterwards. `nx test` fails if it drifts
from the sources — the fingerprint covers the resume data *and* the print layout,
stylesheets and components, because a layout change alters the PDF just as surely as
a bullet does.

The fingerprint hashes **inputs, not output**: Chrome stamps `/CreationDate` and a
trailer `/ID` into every print, so output bytes are not reproducible. The cost is
that reformatting a fingerprinted file invalidates the hash; regenerate and commit.

A fresh clone has a **stub** committed, because the generator needs the app to build
in order to render the routes it prints. The endpoints return 503 in that state.

## Why the PDFs are in the Worker bundle

Anything under `public/` becomes part of `dist/client`, which Cloudflare's asset
handler serves **before** the Worker runs, at a guessable URL. A gated download whose
bytes also sit at `/resume.pdf` is not gated. Compiling them in means there is no
asset to leak.

- Base64 costs ~1% over the raw PDF once gzip runs. The compressed server bundle sits
  at ~0.55 MB of the 3 MB Workers Free ceiling.
- **Standard base64, never base64url.** `check-bundle-secrets.mjs` matches
  `/sk-(proj-)?[A-Za-z0-9]{32,}/`, and base64url's `-` can form that `sk-` prefix —
  measured as a false positive in 13 of 20 sampled encodings. A spec asserts the
  alphabet.
- `check-gated-assets.mjs` runs in CI and before both deploys. It checks magic bytes,
  not just extensions, so a PDF committed as `brochure.webp` is caught too.

## Watermarking, and why it looks the way it does

Every served PDF names who asked for it. This account is on Workers Free — ~10 ms CPU
per request — so loading a 400 KB PDF into `pdf-lib` and re-saving is not available at
any price. Instead the slot is prepared at generation and only filled at serve time:
copy the buffer, overwrite fixed offsets with the same number of bytes. No length
change, so no `/Length` fixup and no xref rewrite. Measured at 46–127 µs.

Two details are load-bearing:

1. **The overlay is its own `PDFRawStream` with no `/Filter`.** Text drawn through
   `page.drawText` lands in a `FlateDecode` stream as a hex string, where no literal
   placeholder exists to find.
2. **The font is standard-14 Helvetica, which is not subset.** A subset font carries
   only the glyphs actually drawn — here `#` — so substituting an address would
   reference glyphs the document does not contain.

If either regresses, the generator's offset scan finds nothing and fails loudly.

To be plain about what this is: attribution, not prevention. Screen capture happens
in the OS compositor, below the browser; no web API observes it, and there is no web
equivalent of `FLAG_SECURE`. A watermark makes a forwarded copy traceable. The
protection that matters is that no PDF exists at a public URL.

`@media print` on the visible resume swaps it for a notice pointing at the request
form, which closes the easiest route around the gate — casual print-to-PDF.

## Secrets

No new ones. `AIR_SIGNING_SECRET` signs download tokens and
`DISCORD_ACCESS_WEBHOOK_URL` receives the lead.

Because one secret now signs two unrelated grants, tokens are **purpose-scoped**: the
purpose is mixed into the signature *and* carried as a `p` claim, and verification
checks both. The prefix prevents cross-purpose replay today; the claim stops a later
refactor that drops the prefix from silently re-opening it.

## Local development

`readSecret` reads only from `cloudflare:workers` and has no `import.meta.env`
fallback, so the request/download flow returns 503 under `astro dev`. Use
`.dev.vars` (gitignored) and serve the built Worker:

```bash
cd packages/web-astro
printf 'AIR_SIGNING_SECRET=local-not-a-secret\n' >> .dev.vars
PUBLIC_SHOW_RESUME=true npx astro build
npx wrangler dev -c dist/server/wrangler.json --port 4319 --local
```

Note two documented quirks. `tierFromRequest` reports **production** from localhost,
because wrangler serves the Worker under the custom domain in `wrangler.jsonc` — the
derivation is right, the local host is the lie, so per-tier behaviour has to be
verified by unit test (`src/pages/robots.spec.ts`) and on a real tier. And a
`wrangler dev` started *before* a rebuild keeps serving the previous asset snapshot:
the page returns 200 while every stylesheet 404s. Restart it after building.

## Known gaps

- **Emailed download links.** The endpoint hands links straight back to the browser.
  Emailing them would verify the address, and needs Cloudflare Email Sending
  (Workers Paid). `approve.ts` already shows the degradation pattern to follow.
- **A.I.R. cannot answer resume questions.** Its corpus is `star` + `projects`, and
  `prompt.mjs` builds model context from frontmatter only — it never sees a markdown
  body. Making the resume retrievable means restructuring it as a sealed markdown
  collection *and* changing the prompt path, which the eval suite guards.
- **`ENGINEER_COUNT` is `~100`** and the optional Inkitt-interview sentence is off.
  Both are one-line changes in `resume.data.ts`.
