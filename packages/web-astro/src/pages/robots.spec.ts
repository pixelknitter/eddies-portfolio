import { describe, it, expect } from 'vitest';
import { GET, prerender } from './robots.txt';

/**
 * These assertions exist because the behaviour they cover is **not observable
 * locally over HTTP**. `wrangler dev` serves the Worker under the custom domain
 * declared in wrangler.jsonc, so a request arrives with `Host: eddie.engineering`
 * no matter what header you send — a curl with `Host: staging.eddie.engineering`
 * still reports the production tier. The derivation is right; the local host is
 * the lie (see the note in util/air/tier.mjs).
 *
 * So the branch is verified here, against the handler, and confirmed for real
 * only on a deployed tier.
 */

/** Minimal stand-in for what the route actually reads. */
function invoke(host: string) {
  const url = new URL('https://example.test/robots.txt');
  const request = new Request(url, { headers: { host } });
  // The route only uses `request` and `url` from the context.
  return GET({ request, url } as unknown as Parameters<typeof GET>[0]) as Response;
}

async function body(host: string) {
  return await invoke(host).text();
}

describe('robots.txt', () => {
  // A prerendered route runs once at build time with no request, so every tier
  // would ship whichever answer the build happened to compute. That would defeat
  // the entire purpose of deriving the tier from the host.
  it('is not prerendered', () => {
    expect(prerender).toBe(false);
  });

  it('invites crawlers on production', async () => {
    const text = await body('eddie.engineering');
    expect(text).toContain('Allow: /');
    expect(text).not.toContain('Disallow: /\n');
    expect(text).toContain('# Tier: production');
  });

  it('invites crawlers on the www host too', async () => {
    expect(await body('www.eddie.engineering')).toContain('Allow: /');
  });

  // The reason this route exists: staging and every per-PR preview answer on
  // real *.eddie.engineering subdomains. Indexed, they compete with production
  // for the same person and a stale copy can win.
  it('blocks everything on staging', async () => {
    const text = await body('staging.eddie.engineering');
    expect(text).toContain('Disallow: /');
    expect(text).not.toContain('Allow: /');
    expect(text).toContain('# Tier: staging');
  });

  it('blocks everything on a per-PR dev preview', async () => {
    const text = await body('feat-resume-dev.eddie.engineering');
    expect(text).toContain('Disallow: /');
    expect(text).not.toContain('Allow: /');
  });

  // Unrecognised hosts resolve to `dev`, i.e. blocked. Under-claiming is the
  // safe direction: a new hostname should not start inviting crawlers by default.
  it('blocks an unrecognised host', async () => {
    const text = await body('eddies-portfolio.workers.dev');
    expect(text).toContain('Disallow: /');
  });

  it('keeps endpoints and the print routes out on production', async () => {
    const text = await body('eddie.engineering');
    expect(text).toContain('Disallow: /api/');
    expect(text).toContain('Disallow: /cv/print/');
  });

  it('serves plain text and varies on host', () => {
    const response = invoke('eddie.engineering');
    expect(response.headers.get('content-type')).toContain('text/plain');
    // A shared cache keyed only on path would hand one tier's answer to another.
    expect(response.headers.get('vary')).toBe('host');
  });

  // Advertising a sitemap that 404s is worse than omitting the line.
  it('advertises no sitemap while none is generated', async () => {
    expect(await body('eddie.engineering')).not.toContain('Sitemap:');
  });
});
