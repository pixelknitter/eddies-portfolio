import type { APIContext } from 'astro';

import { showAIR } from '@util/visibility.mjs';
import { readBinding, readSecret } from '@util/air/runtime.mjs';
import { mintAccessCode, verifyApprovalToken } from '@util/air/requests.mjs';
import { accessGrantedEmail, escapeHtml } from '@util/air/email.mjs';
import { tierFromRequest, TIER_STYLE } from '@util/air/tier.mjs';

/**
 * Approval endpoint — the target of the link in the Discord notification.
 *
 * Eddie clicks it in a browser, so it answers with a readable page rather than
 * JSON. Clicking again re-sends the same code to the same address and nothing
 * else; see requests.mjs for why that is preferable to a single-use token.
 *
 * It is a GET because a link in a Discord embed is a GET — which does mean any
 * link preview crawler that follows it will trigger a send. That is acceptable
 * precisely because the action is idempotent and bound to one recipient: the
 * worst case is the requester receiving their code slightly early.
 */

type EmailBinding = {
  send(message: {
    to: string;
    from: { email: string; name?: string };
    subject: string;
    html: string;
    text: string;
    replyTo?: string;
  }): Promise<unknown>;
};

/** The alias approvals are sent from. Its domain must be onboarded to Email Sending. */
const FROM_ADDRESS = 'connect@eddie.engineering';
const FROM_NAME = 'Eddie Freeman';

function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width" />
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:48px 24px;background:#1e1e2e;color:#fdebf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<div style="max-width:520px;margin:0 auto;">
<h1 style="font-size:22px;margin:0 0 16px;">${escapeHtml(title)}</h1>
${body}
</div></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } }
  );
}

export async function GET(context: APIContext): Promise<Response> {
  if (!showAIR(import.meta.env)) {
    return new Response(null, { status: 404, statusText: 'Not found' });
  }

  const token = context.url.searchParams.get('token');
  const signingSecret = await readSecret('AIR_SIGNING_SECRET');

  if (!signingSecret) {
    console.error('[air] AIR_SIGNING_SECRET is not configured');
    return page('Not configured', '<p>A.I.R. approvals are not set up on this deployment.</p>', 503);
  }

  const verified = await verifyApprovalToken(signingSecret, token);
  if (!verified.ok) {
    return page(
      'That link is no longer valid',
      `<p style="line-height:1.6;">${escapeHtml(verified.reason)} — approval links last seven days. Ask them to request access again.</p>`,
      400
    );
  }

  const tier = TIER_STYLE[tierFromRequest(context.request, context.url)].label;
  const code = await mintAccessCode(signingSecret, verified.email);
  const airUrl = new URL('/air/', context.url).toString();
  const message = accessGrantedEmail({ code, airUrl });

  const email = (await readBinding('EMAIL')) as EmailBinding | undefined;
  if (!email) {
    // Not an error. Cloudflare Email Sending requires the Workers Paid plan,
    // so on Free there is no binding to have — approving by hand is the
    // supported path, not a degraded one. A 500 here would page someone about
    // a working system.
    return page(
      'Approved — send them this code',
      `<p style="line-height:1.6;">Email sending is not enabled on this account, so pass this to
       <strong>${escapeHtml(verified.email)}</strong> yourself:</p>
       <p style="padding:16px;background:#3b3458;border-radius:8px;font-family:ui-monospace,monospace;word-break:break-all;font-size:15px;">${escapeHtml(code)}</p>
       <p style="line-height:1.6;color:#b9b4d4;font-size:14px;">They asked: &ldquo;${escapeHtml(verified.reason)}&rdquo;</p>
       <p style="line-height:1.6;color:#b9b4d4;font-size:14px;">Environment: <strong>${escapeHtml(tier)}</strong>. This code only opens that one.</p>
       <p style="line-height:1.6;color:#b9b4d4;font-size:14px;">The code is tied to that address and does not expire. Reloading this page shows the same one.</p>`
    );
  }

  try {
    await email.send({
      to: verified.email,
      from: { email: FROM_ADDRESS, name: FROM_NAME },
      replyTo: FROM_ADDRESS,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
  } catch (error) {
    console.error('[air] sending the approval email failed', error);
    return page(
      'Approved, but the email bounced',
      `<p style="line-height:1.6;">Sending to <strong>${escapeHtml(verified.email)}</strong> failed.
       Their code is below — send it by hand, or click the link again to retry.</p>
       <p style="padding:16px;background:#3b3458;border-radius:8px;font-family:ui-monospace,monospace;word-break:break-all;">${escapeHtml(code)}</p>`,
      502
    );
  }

  return page(
    'Approved',
    `<p style="line-height:1.6;">A code is on its way to <strong>${escapeHtml(verified.email)}</strong> from ${FROM_ADDRESS}.</p>
     <p style="line-height:1.6;color:#b9b4d4;font-size:14px;">They asked: &ldquo;${escapeHtml(verified.reason)}&rdquo;</p>
     <p style="line-height:1.6;color:#b9b4d4;font-size:14px;">Environment: <strong>${escapeHtml(tier)}</strong>. This code only opens that one.</p>
     <p style="line-height:1.6;color:#b9b4d4;font-size:14px;">Clicking this link again just re-sends the same code to the same address.</p>`
  );
}
