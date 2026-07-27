import type { APIContext } from 'astro';

import { showAIR } from '@util/visibility.mjs';
import { createRateLimiter } from '@util/air/access.mjs';
import { readSecret } from '@util/air/runtime.mjs';
import { mintApprovalToken, validateRequest } from '@util/air/requests.mjs';
import { accessRequestNotification } from '@util/air/email.mjs';

/**
 * Access-request endpoint.
 *
 * A visitor leaves an address and a note about why they are reaching out. That
 * goes to Discord with an approval link; nothing is emailed and no access is
 * granted until Eddie clicks it.
 *
 * Nothing is stored. The approval link carries the request inside a signed
 * token, so the request survives without a datastore and cannot be tampered
 * with in transit — see requests.mjs for why that beats single-use tokens.
 */

// Stricter than the ask limiter: a request costs Eddie attention, and the
// endpoint is unauthenticated, so it is the more attractive thing to abuse.
const limiter = createRateLimiter({ limit: 3, windowMs: 10 * 60_000 });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(context: APIContext): Promise<Response> {
  if (!showAIR(import.meta.env)) {
    return new Response(null, { status: 404, statusText: 'Not found' });
  }

  const clientId =
    context.request.headers.get('cf-connecting-ip') ??
    context.request.headers.get('x-forwarded-for') ??
    'unknown';

  if (!limiter.check(clientId).allowed) {
    return json({ error: 'That is a lot of requests. Try again in a little while.' }, 429);
  }

  let payload: unknown;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400);
  }

  const { email, reason } = (payload ?? {}) as { email?: unknown; reason?: unknown };
  const validated = validateRequest(email, reason);
  if (!validated.ok) return json({ error: validated.reason }, 400);

  const signingSecret = await readSecret('AIR_SIGNING_SECRET');
  const webhookUrl = await readSecret('DISCORD_ACCESS_WEBHOOK_URL');

  if (!signingSecret || !webhookUrl) {
    console.error('[air] access requests are not configured (signing secret or webhook missing)');
    return json({ error: 'Requests are not open right now. Try again later.' }, 503);
  }

  const token = await mintApprovalToken(signingSecret, {
    email: validated.email,
    reason: validated.reason,
    issuedAt: Date.now(),
  });

  const approveUrl = new URL(`/api/air/approve?token=${encodeURIComponent(token)}`, context.url)
    .toString();

  const notification = accessRequestNotification({
    email: validated.email,
    reason: validated.reason,
    approveUrl,
  });

  const discordResponse = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(notification),
  });

  if (!discordResponse.ok) {
    // The visitor did nothing wrong, so do not blame them — but do not claim
    // the request landed either, because it did not.
    console.error(`[air] discord webhook failed: ${discordResponse.status}`);
    return json({ error: 'Could not pass that along just now. Try again shortly.' }, 502);
  }

  return json({
    ok: true,
    message:
      "Sent. Eddie reviews these himself, so it won't be instant — you'll get an email with a code once he's had a look.",
  });
}
