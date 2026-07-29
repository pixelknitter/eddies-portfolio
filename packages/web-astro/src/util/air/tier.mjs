/**
 * Which deployment tier a request landed on.
 *
 * Derived from the hostname rather than from a build-time variable on
 * purpose. A variable has to be set correctly on three pipelines and can
 * silently disagree with reality — a preview built with the staging value
 * would announce itself as staging forever. The hostname is the one thing
 * that cannot be wrong about where a request actually arrived.
 *
 * This matters for approvals because each tier signs with its own secret: a
 * code issued from staging will not open production. Anyone approving needs
 * to know which one they are granting before they click, not after someone
 * reports the code does not work.
 */

/**
 * @typedef {'production' | 'staging' | 'dev' | 'local'} Tier
 */

/**
 * Pick the host to judge from a request.
 *
 * The `Host` header is what the client actually asked for, which is more
 * truthful than Astro's reconstructed `context.url`.
 *
 * **Known limitation, measured rather than assumed:** under `wrangler dev`
 * this still reports Production from localhost. Wrangler serves the Worker
 * under the custom domain declared in wrangler.jsonc, so the request really
 * does arrive with `Host: eddie.engineering` — the derivation is correct, the
 * local host is the lie. Confirmed by sending a request through a local
 * webhook sink and reading the payload.
 *
 * It is correct on every deployed tier, because make-worker-variant.mjs
 * replaces `routes` wholesale per tier, so each Worker only ever answers on
 * its own hostname. Verify it there, not locally. Special-casing wrangler dev
 * was deliberately not done: it would mask a genuine misreport later.
 *
 * @param {Request} request
 * @param {URL} [url] Fallback when there is no Host header.
 * @returns {Tier}
 */
export function tierFromRequest(request, url) {
  const host = request?.headers?.get?.('host');
  // Strip any port before matching — `localhost:4411` is still localhost.
  return tierFromHostname((host ?? url?.hostname ?? '').split(':')[0]);
}

/**
 * @param {string | undefined} hostname
 * @returns {Tier}
 */
export function tierFromHostname(hostname) {
  const host = String(hostname ?? '').toLowerCase();

  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')) return 'local';
  if (host === 'staging.eddie.engineering') return 'staging';

  // Per-PR previews are <branch>-dev.eddie.engineering.
  if (host.endsWith('-dev.eddie.engineering')) return 'dev';
  if (host === 'eddie.engineering' || host === 'www.eddie.engineering') return 'production';

  // Anything unrecognised — a workers.dev URL, a hostname added later — is
  // reported as dev rather than assumed to be production. Under-claiming is
  // the safe direction: it prompts a second look instead of granting
  // production access on a guess.
  return 'dev';
}

/** Presentation for each tier, used in the Discord notification. */
export const TIER_STYLE = {
  production: { label: 'Production', colour: 0x5dd39e },
  staging: { label: 'Staging', colour: 0xd9a441 },
  dev: { label: 'Dev preview', colour: 0x584966 },
  local: { label: 'Local', colour: 0x5c5b77 },
};
