import type { APIContext } from 'astro';

import { showResume } from '@util/visibility.mjs';
import { createRateLimiter } from '@util/air/access.mjs';
import { readSecret } from '@util/air/runtime.mjs';
import {
  mintPurposeToken,
  validateRequest,
  RESUME_DOWNLOAD_TTL_MS,
} from '@util/air/requests.mjs';
import { tierFromRequest } from '@util/air/tier.mjs';
import { resumeRequestNotification } from '@util/resume/notify.mjs';
import { RESUME_PDFS } from '@util/resume/pdfs.generated.mjs';

/**
 * Resume download request — the lead-capture gate.
 *
 * A visitor leaves an address and a line about why they are interested, and gets
 * the PDFs immediately via short-lived signed links. Deliberately low friction:
 * the goal is to know who is reading the resume, not to make them wait.
 *
 * ## How this differs from /api/air/request, on purpose
 *
 * That endpoint asks Eddie to decide, and returns 502 when Discord is unreachable
 * because for A.I.R. the notification *is* the request — losing it means the
 * request never happened.
 *
 * Here the download is the product and the notification is CRM. So a webhook
 * failure **fails open**: log it, report `notified: false`, and still hand over the
 * links. Failing a stranger's download because the CRM is down punishes exactly the
 * lead the feature exists to capture. The trade-off is that an abuser could pull
 * PDFs unobserved — bounded by the rate limiter, and the download endpoint logs the
 * address from the token either way, so the lead is still recoverable from logs.
 *
 * Nothing is stored. The grant lives inside the signed token.
 */

// Looser than A.I.R.'s 3: a real download is worth retrying, and this costs
// attention rather than a decision. Still bounded, because it is unauthenticated.
const limiter = createRateLimiter({ limit: 5, windowMs: 10 * 60_000 });

/** Which downloads a request can ask for. */
const FORMATS = ['human', 'bot', 'both'] as const;
type Format = (typeof FORMATS)[number];

/**
 * A guard rather than a bare `includes`, so the checked value is actually narrowed.
 * `includes` validates and returns a boolean while leaving the variable `unknown`,
 * which then needs a cast at every use — and a cast is exactly the thing that stops
 * being true when the shape changes.
 */
function isFormat(value: unknown): value is Format {
  return (
    typeof value === 'string' && (FORMATS as readonly string[]).includes(value)
  );
}

const LABELS: Record<'human' | 'bot', string> = {
  human: 'Full resume (human readable)',
  bot: 'Full resume (bot readable)',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(context: APIContext): Promise<Response> {
  if (!showResume(import.meta.env)) {
    return new Response(null, { status: 404, statusText: 'Not found' });
  }

  const clientId =
    context.request.headers.get('cf-connecting-ip') ??
    context.request.headers.get('x-forwarded-for') ??
    'unknown';

  if (!limiter.check(clientId).allowed) {
    return json(
      { error: 'That is a lot of requests. Try again in a little while.' },
      429,
    );
  }

  let payload: unknown;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400);
  }

  const {
    email,
    reason,
    format = 'both',
  } = (payload ?? {}) as {
    email?: unknown;
    reason?: unknown;
    format?: unknown;
  };

  // Reused verbatim from A.I.R.: same bounds, same deliberately loose email check,
  // and already tested. The note requirement is the point of the gate — an address
  // with no context is not a lead.
  const validated = validateRequest(email, reason);
  if (!validated.ok) return json({ error: validated.reason }, 400);

  if (!isFormat(format)) {
    return json({ error: `format must be one of: ${FORMATS.join(', ')}` }, 400);
  }

  // A fresh clone ships the stub, so say so plainly rather than serving 0 bytes.
  if (RESUME_PDFS.human.bytes === 0 && RESUME_PDFS.bot.bytes === 0) {
    console.error(
      '[resume] pdfs.generated.mjs is a stub — run `yarn resume:pdf`',
    );
    return json({ error: 'The download is not available right now.' }, 503);
  }

  const signingSecret = await readSecret('AIR_SIGNING_SECRET');
  if (!signingSecret) {
    console.error(
      '[resume] downloads are not configured (signing secret missing)',
    );
    return json({ error: 'The download is not available right now.' }, 503);
  }

  const wanted: Array<'human' | 'bot'> =
    format === 'both' ? ['human', 'bot'] : [format];

  const downloads = await Promise.all(
    wanted.map(async (variant) => {
      // The token carries both the address (which becomes the watermark) and the
      // variant it is good for, so a token issued for one cannot fetch the other.
      const token = await mintPurposeToken(signingSecret, 'download', {
        email: validated.email,
        format: variant,
      });
      return {
        format: variant,
        label: LABELS[variant],
        filename: RESUME_PDFS[variant].filename,
        // Relative, deliberately. The caller is always same-origin, and building
        // this absolute from `context.url` takes the host from a header that can be
        // rewritten — under `wrangler dev` it becomes eddie.engineering, so a local
        // download link points at production. A path cannot be wrong that way.
        url: `/api/resume/download?format=${variant}&token=${encodeURIComponent(token)}`,
      };
    }),
  );

  // Fire-and-report. See the note above on why this does not gate the response.
  let notified = false;
  const webhookUrl = await readSecret('DISCORD_ACCESS_WEBHOOK_URL');
  if (webhookUrl) {
    try {
      const notification = resumeRequestNotification({
        email: validated.email,
        reason: validated.reason,
        format,
        // From the Host header the request actually carried, so the links and the
        // environment reported can never disagree.
        tier: tierFromRequest(context.request, context.url),
      });
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(notification),
      });
      notified = response.ok;
      if (!response.ok)
        console.error(`[resume] discord webhook failed: ${response.status}`);
    } catch (error) {
      console.error('[resume] discord webhook threw', error);
    }
  } else {
    console.error(
      '[resume] DISCORD_ACCESS_WEBHOOK_URL missing — lead not recorded',
    );
  }

  return json({
    ok: true,
    downloads,
    expiresInSeconds: Math.floor(RESUME_DOWNLOAD_TTL_MS / 1000),
    notified,
    message:
      'Thanks — your download is starting. The links stay valid for 15 minutes.',
  });
}
