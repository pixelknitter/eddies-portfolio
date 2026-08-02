import type { APIRoute } from 'astro';
import { tierFromRequest } from '@util/air/tier.mjs';

/**
 * robots.txt, decided per tier.
 *
 * The resume is meant to be crawled — that is the point of the machine-readable
 * page and its JSON-LD. But staging and every per-PR dev Worker answer on real
 * `*.eddie.engineering` subdomains, and until now nothing stopped those being
 * indexed. For a resume that is worse than untidy: it offers search and
 * generative engines several near-identical copies of the same person at
 * different URLs, and the stale one can win.
 *
 * ## Why the tier comes from the request, not the build
 *
 * `tierFromRequest` reads the `Host` header. A build-time variable has to be set
 * correctly on three pipelines and can silently disagree with reality — a
 * preview built with the production value would invite crawlers forever. The
 * hostname is the one thing that cannot be wrong about where a request arrived.
 * See the reasoning in `util/air/tier.mjs`.
 *
 * Note its documented local quirk: under `wrangler dev` the Worker is served on
 * the custom domain from wrangler.jsonc, so this reports `production` locally.
 * That is the local host lying, not the derivation. Verify on a deployed tier.
 *
 * ## Not prerendered
 *
 * `prerender = false` is required: a prerendered route is evaluated once at build
 * time with no request, so every tier would ship whatever the build decided.
 */
export const prerender = false;

/** Paths no tier should ever invite a crawler into. */
const ALWAYS_DISALLOWED = [
  // Endpoints, not documents. The download endpoint in particular should never
  // be fetched speculatively — it consumes a signed, expiring token.
  '/api/',
  // The print-render routes exist only for the PDF generator and carry contact
  // details. They 404 on deployed tiers anyway; this is the belt to that braces.
  '/cv/print/',
];

export const GET: APIRoute = ({ request, url }) => {
  const tier = tierFromRequest(request, url);
  const isProduction = tier === 'production';

  const lines = [
    '# Generated per deployment tier — see src/pages/robots.txt.ts',
    `# Tier: ${tier}`,
    '',
  ];

  lines.push('User-agent: *');

  if (isProduction) {
    for (const path of ALWAYS_DISALLOWED) lines.push(`Disallow: ${path}`);
    lines.push('Allow: /');
    // No `Sitemap:` line: this repo generates no sitemap, and advertising one
    // that 404s is worse than omitting it. Add the line with @astrojs/sitemap.
  } else {
    // Everything, on every non-production tier. Staging and previews exist to be
    // reviewed by people, not archived by robots.
    lines.push('Disallow: /');
  }

  return new Response(`${lines.join('\n')}\n`, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      // Short cache: the answer depends on the host, and a shared cache keyed
      // only on path would otherwise hand one tier's answer to another.
      'cache-control': 'public, max-age=300',
      vary: 'host',
    },
  });
};
