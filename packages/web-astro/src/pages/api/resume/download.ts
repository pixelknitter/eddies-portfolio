import type { APIContext } from 'astro';

import { resolveSections } from '@util/flags/sections.mjs';
import { createRateLimiter } from '@util/air/access.mjs';
import { readSecret } from '@util/air/runtime.mjs';
import { verifyPurposeToken } from '@util/air/requests.mjs';
import { escapeHtml } from '@util/html.mjs';
import { RESUME_PDFS, GENERATED_AT } from '@util/resume/pdfs.generated.mjs';
import { applyWatermark, composeWatermark } from '@util/resume/watermark.mjs';

/**
 * Serve a gated resume PDF.
 *
 * The PDFs are compiled into this Worker rather than published as assets, so this
 * is the only route to the bytes and a signed token is the only way through it.
 *
 * Each response is watermarked with the address from the token — not from the query
 * string, so it cannot be forged. See util/resume/watermark.mjs for why the patch is
 * a fixed-offset byte write rather than a PDF edit.
 */

// A valid token should not be a firehose: every hit copies and patches a few
// hundred KB. Generous enough for a retry and a second format.
const limiter = createRateLimiter({ limit: 12, windowMs: 10 * 60_000 });

/**
 * Decoded PDFs, cached per isolate.
 *
 * Decoding ~800KB of base64 on every request would be wasteful, and doing it at
 * module scope would charge it to isolate startup — which has its own CPU budget
 * and would slow every unrelated request on a cold start. So it happens on first
 * use and is kept.
 *
 * `applyWatermark` copies rather than mutating, precisely because these buffers are
 * shared across requests; patching in place would leak one requester's address into
 * the next download.
 */
const decoded = new Map<string, Uint8Array>();

function decode(format: 'human' | 'bot'): Uint8Array {
  const cached = decoded.get(format);
  if (cached) return cached;

  const base64 = RESUME_PDFS[format].base64;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  decoded.set(format, bytes);
  return bytes;
}

/**
 * An HTML answer, because this URL is reached by navigation.
 *
 * A raw JSON blob is the wrong thing to show someone whose link has expired. The
 * styling mirrors api/air/approve.ts so the two failure pages look like one site.
 */
function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:48px 24px;background:#1e1e2e;color:#fdebf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<main style="max-width:520px;margin:0 auto;">
<h1 style="font-size:22px;margin:0 0 16px;">${escapeHtml(title)}</h1>
${body}
</main></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

/** JSON only when the caller asked for it; otherwise a readable page. */
function fail(
  context: APIContext,
  status: number,
  title: string,
  detail: string,
) {
  const accept = context.request.headers.get('accept') ?? '';
  if (accept.includes('application/json')) {
    return new Response(JSON.stringify({ error: detail }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }
  return page(
    title,
    `<p style="line-height:1.6;">${escapeHtml(detail)}</p>
     <p style="line-height:1.6;"><a href="/air/resume/" style="color:#5dd39e;">Request a fresh copy</a></p>`,
    status,
  );
}

export async function GET(context: APIContext): Promise<Response> {
  const sections = await resolveSections(import.meta.env);
  if (!sections.resume) {
    return new Response(null, { status: 404, statusText: 'Not found' });
  }

  const clientId =
    context.request.headers.get('cf-connecting-ip') ??
    context.request.headers.get('x-forwarded-for') ??
    'unknown';

  if (!limiter.check(clientId).allowed) {
    return fail(
      context,
      429,
      'Slow down a moment',
      'Too many downloads just now.',
    );
  }

  const requested = context.url.searchParams.get('format');
  if (requested !== 'human' && requested !== 'bot') {
    return fail(
      context,
      400,
      'That link is incomplete',
      'Unknown download format.',
    );
  }

  const signingSecret = await readSecret('AIR_SIGNING_SECRET');
  if (!signingSecret) {
    console.error(
      '[resume] downloads are not configured (signing secret missing)',
    );
    return fail(
      context,
      503,
      'Not available',
      'Downloads are not available right now.',
    );
  }

  const verified = await verifyPurposeToken(
    signingSecret,
    'download',
    context.url.searchParams.get('token'),
  );
  if (!verified.ok) {
    return fail(
      context,
      403,
      'That link is no longer valid',
      `${verified.reason} — download links last 15 minutes.`,
    );
  }

  // The token names the format it was issued for. Without this a `bot` token could
  // fetch the human PDF by editing the query string — the signature covers the
  // claim, but only if someone checks it.
  const granted = verified.claims.format;
  if (granted !== requested) {
    return fail(
      context,
      403,
      'That link is for a different file',
      'This link does not open that download.',
    );
  }

  const pdf = RESUME_PDFS[requested];
  if (pdf.bytes === 0) {
    console.error(
      '[resume] pdfs.generated.mjs is a stub — run `yarn resume:pdf`',
    );
    return fail(
      context,
      503,
      'Not available',
      'The download is not built yet.',
    );
  }

  const email =
    typeof verified.claims.email === 'string' ? verified.claims.email : '';
  const body = applyWatermark(
    decode(requested),
    pdf.watermarkOffsets,
    composeWatermark({ email, date: GENERATED_AT }),
  );

  // The second attribution channel, and the one that survives if watermarking ever
  // degrades: who fetched what, from where.
  console.log(
    `[resume] served ${requested} to ${email} (${clientId}, ${pdf.pages}pp, ${pdf.bytes}b)`,
  );

  return new Response(body, {
    headers: {
      'content-type': 'application/pdf',
      // Generic filename on purpose: it lands in their Downloads folder and travels
      // with every forward, so it must not carry their address. The identity is in
      // the document.
      'content-disposition': `attachment; filename="${pdf.filename}"`,
      'content-length': String(body.length),
      // Personalised bytes must never be cached by anything shared.
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex, nofollow, noarchive',
    },
  });
}
