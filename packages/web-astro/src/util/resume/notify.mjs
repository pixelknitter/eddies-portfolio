import { TIER_STYLE } from '../air/tier.mjs';

/**
 * The Discord notification for a resume download.
 *
 * ## This is a lead, not an approval
 *
 * A.I.R.'s notification exists so Eddie can *decide* — it carries an approve link
 * and nothing happens until he clicks. This one is a record: the download has
 * already been served by the time it arrives. So it reports rather than asks, and
 * it carries the two things worth acting on — who, and why they said they wanted it.
 *
 * That difference is also why the request endpoint does not fail when the webhook
 * does. For A.I.R. the notification *is* the request; here the download is the
 * product and this is the CRM entry.
 *
 * @param {{email: string, reason: string, format: string, tier?: string}} input
 */
export function resumeRequestNotification({
  email,
  reason,
  format,
  tier = 'dev',
}) {
  const style = TIER_STYLE[tier] ?? TIER_STYLE.dev;

  return {
    embeds: [
      {
        title: `📄 Resume downloaded — ${style.label}`,
        color: style.colour,
        fields: [
          { name: 'From', value: email },
          {
            name: 'Why',
            // Discord truncates long field values silently; trim first so the
            // truncation is visible and the payload is never rejected outright.
            value: reason.length > 900 ? `${reason.slice(0, 900)}…` : reason,
          },
          { name: 'Format', value: format, inline: true },
          { name: 'Environment', value: style.label, inline: true },
        ],
        description:
          'The file was served immediately, watermarked with their address. ' +
          'No approval needed — this is the lead, not a request.',
      },
    ],
  };
}
