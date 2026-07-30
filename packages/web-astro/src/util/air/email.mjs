import { TIER_STYLE } from './tier.mjs';
import { escapeHtml } from '../html.mjs';

/**
 * The one transactional email A.I.R. sends.
 *
 * ## Why not React Email
 *
 * React Email is the right tool once there are several templates to keep
 * consistent — it earns its keep through shared components and previews. For a
 * single email it would pull `react-dom/server` into a Worker bundle to render
 * markup that does not change, on a runtime where bundle size is latency. The
 * Cloudflare send binding takes `html` and `text` strings directly, so there is
 * nothing to adapt.
 *
 * If a second or third email appears — a follow-up, a revocation notice — that
 * calculus flips and this module is the seam to swap: it returns exactly what
 * the binding needs, so the renderer behind it can change without touching a
 * caller.
 *
 * Both `html` and `text` are always produced. Some clients show only the plain
 * part, and a missing text alternative reads as a spam signal.
 */

/**
 * Escape untrusted text for HTML.
 *
 * The reason string is written by a stranger and is echoed back in the mail
 * Eddie reads, so it goes through here before it lands in markup.
 *
 * Re-exported rather than defined here: the resume surfaces need the same
 * function, and one shared implementation cannot drift from itself. It is
 * imported at the top of this module as well as re-exported — a bare
 * `export … from` would satisfy importers while leaving the name unbound for
 * this module's own use, which is exactly the bug the email-template test
 * caught.
 */
export { escapeHtml };

/**
 * The email a requester receives once Eddie approves them.
 *
 * @param {{code: string, airUrl: string}} input
 * @returns {{subject: string, html: string, text: string}}
 */
export function accessGrantedEmail({ code, airUrl }) {
  const subject = 'Your access to A.I.R.';

  const text = [
    "You asked to try A.I.R., the interactive resume on Eddie Freeman's site.",
    '',
    'Here is your access code:',
    '',
    `  ${code}`,
    '',
    `Paste it into the access field at ${airUrl} and ask away.`,
    '',
    'A.I.R. answers from Eddie\'s written work and tells you when a question',
    "isn't something it can speak to. If it declines, that's the honest answer",
    'rather than a failure.',
    '',
    'Reply to this email if you would rather just talk to a person.',
    '',
    '— Eddie',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#fdebf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e1e2e;">
    <table role="presentation" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <tr><td>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">
          You asked to try A.I.R., the interactive resume on Eddie Freeman&rsquo;s site.
        </p>
        <p style="margin:0 0 8px;font-size:14px;line-height:1.6;">Here is your access code:</p>
        <p style="margin:0 0 24px;padding:16px;background:#fdebf3;border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:14px;word-break:break-all;">
          ${escapeHtml(code)}
        </p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;">
          Paste it into the access field at
          <a href="${escapeHtml(airUrl)}" style="color:#348aa7;">${escapeHtml(airUrl)}</a>
          and ask away.
        </p>
        <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#525174;">
          A.I.R. answers from Eddie&rsquo;s written work and tells you when a question isn&rsquo;t
          something it can speak to. If it declines, that&rsquo;s the honest answer rather than a
          failure.
        </p>
        <p style="margin:0;font-size:14px;line-height:1.6;">
          Reply to this email if you would rather just talk to a person.
        </p>
        <p style="margin:24px 0 0;font-size:14px;">&mdash; Eddie</p>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}

/**
 * The Discord notification Eddie approves from.
 *
 * The tier is in the title and the colour because every tier signs with its
 * own secret — a code approved from staging will not open production. Which
 * environment you are granting has to be obvious before the click, not
 * discovered afterwards when someone says the code does not work.
 *
 * @param {{email: string, reason: string, approveUrl: string, tier?: string}} input
 */
export function accessRequestNotification({ email, reason, approveUrl, tier = 'dev' }) {
  const style = TIER_STYLE[tier] ?? TIER_STYLE.dev;

  return {
    embeds: [
      {
        title: `🔑 A.I.R. access requested — ${style.label}`,
        color: style.colour,
        fields: [
          { name: 'From', value: email },
          // Discord truncates long field values, so trim before it does and
          // make the truncation visible rather than silent.
          {
            name: 'Why',
            value: reason.length > 900 ? `${reason.slice(0, 900)}…` : reason,
          },
          { name: 'Environment', value: style.label, inline: true },
        ],
        description: `[Approve and send them a code](${approveUrl})\n\nThe link stays valid for seven days. Clicking it again just re-sends the same code to the same address.`,
      },
    ],
  };
}
