#!/usr/bin/env node
/**
 * Post-deploy smoke test.
 *
 * Probes a deployed base URL and asserts each route's status code and, where
 * given, that the rendered HTML contains expected content. Run against preview
 * and production deployments so a broken deploy is caught before it is
 * announced as successful.
 *
 * Usage:
 *   node scripts/smoke-test.mjs <base-url>
 *   SMOKE_BASE_URL=https://... node scripts/smoke-test.mjs
 *
 * Cloudflare Access:
 *   Preview URLs are gated by Cloudflare Access, which answers unauthenticated
 *   requests with its own login page. That page returns HTTP 200, so a naive
 *   status check would *pass* against a site it never actually reached. This
 *   script detects the Access interstitial explicitly. Provide a service token
 *   (CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET) to authenticate and run the
 *   real assertions.
 */

const baseUrl = (process.argv[2] || process.env.SMOKE_BASE_URL || '').replace(/\/$/, '');

if (!baseUrl) {
  console.error('✖ No base URL provided. Pass one as an argument or set SMOKE_BASE_URL.');
  process.exit(1);
}

const accessClientId = process.env.CF_ACCESS_CLIENT_ID;
const accessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
const hasAccessCreds = Boolean(accessClientId && accessClientSecret);

const REQUEST_TIMEOUT_MS = 20_000;
const RETRIES = 3;

/** Routes asserted on every deploy. `contains` is checked case-sensitively. */
const checks = [
  { path: '/', status: 200, contains: 'Engineering by Eddie' },
  { path: '/blog/', status: 200, contains: 'Blog' },
  { path: '/works/', status: 200, contains: 'Projects' },
  { path: '/projects/project-1/', status: 200 },
  { path: '/air/', status: 200 },
  // Unknown routes must 404 rather than render a page or error.
  { path: '/this-route-should-not-exist', status: 404 },
];

function headers() {
  return hasAccessCreds
    ? {
        'CF-Access-Client-Id': accessClientId,
        'CF-Access-Client-Secret': accessClientSecret,
      }
    : {};
}

/** True when Cloudflare Access served its login interstitial instead of the app. */
function isAccessInterstitial(response, body) {
  return (
    response.url.includes('cloudflareaccess.com') ||
    response.headers.get('www-authenticate')?.includes('Cloudflare-Access') ||
    /<title>[^<]*Cloudflare Access/i.test(body)
  );
}

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        headers: headers(),
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await response.text();
      return { response, body };
    } catch (error) {
      lastError = error;
      // A freshly published deployment can take a moment to become routable.
      if (attempt < RETRIES) {
        const delay = attempt * 3000;
        console.log(`  … ${url} failed (${error.message}), retrying in ${delay}ms`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

async function main() {
  console.log(`Smoke testing ${baseUrl}`);
  console.log(
    hasAccessCreds
      ? 'Using Cloudflare Access service token.'
      : 'No Cloudflare Access service token configured.'
  );

  // Probe once up front so a gated deployment is reported clearly rather than
  // as a pile of confusing per-route failures.
  const probe = await fetchWithRetry(`${baseUrl}/`);
  if (isAccessInterstitial(probe.response, probe.body)) {
    if (!hasAccessCreds) {
      console.log('');
      console.log('⚠ Deployment is gated by Cloudflare Access and no service token is set.');
      console.log('  Skipping content assertions — the deployment could not be reached.');
      console.log('  To enable real validation, create an Access service token, add it to');
      console.log('  the Access policy, and set CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET.');
      process.exit(0);
    }
    console.error('');
    console.error('✖ Cloudflare Access rejected the service token.');
    console.error('  Confirm the token is included in the Access policy for this hostname.');
    process.exit(1);
  }

  const failures = [];

  for (const check of checks) {
    const url = `${baseUrl}${check.path}`;
    let result;
    try {
      result = await fetchWithRetry(url);
    } catch (error) {
      failures.push(`${check.path} — request failed: ${error.message}`);
      console.log(`✖ ${check.path} — request failed: ${error.message}`);
      continue;
    }

    const { response, body } = result;
    const problems = [];

    if (response.status !== check.status) {
      problems.push(`expected HTTP ${check.status}, got ${response.status}`);
    }
    if (check.contains && !body.includes(check.contains)) {
      problems.push(`body did not contain ${JSON.stringify(check.contains)}`);
    }
    // Guard against a mid-run Access redirect masquerading as success.
    if (isAccessInterstitial(response, body)) {
      problems.push('received the Cloudflare Access login page');
    }

    if (problems.length) {
      failures.push(`${check.path} — ${problems.join('; ')}`);
      console.log(`✖ ${check.path} — ${problems.join('; ')}`);
    } else {
      console.log(`✓ ${check.path} — ${response.status}`);
    }
  }

  // Follow whatever the blog index actually publishes rather than hardcoding
  // a slug: posts are scheduled and drafted, so any fixed URL eventually
  // 404s. This still catches a post page that fails to render.
  let extra = 0;
  try {
    const index = await fetchWithRetry(`${baseUrl}/blog/`);
    const slug = /href="\/blog\/([^"/]+)\/?"/.exec(index.body)?.[1];

    if (!slug) {
      console.log('… no published posts listed; skipping the post-page check.');
    } else {
      extra = 1;
      const post = await fetchWithRetry(`${baseUrl}/blog/${slug}/`);
      if (post.response.status === 200) {
        console.log(`✓ /blog/${slug}/ — 200 (first listed post)`);
      } else {
        failures.push(`/blog/${slug}/ — expected HTTP 200, got ${post.response.status}`);
        console.log(`✖ /blog/${slug}/ — expected HTTP 200, got ${post.response.status}`);
      }
    }
  } catch (error) {
    failures.push(`blog index — ${error.message}`);
    console.log(`✖ blog index — ${error.message}`);
  }

  const total = checks.length + extra;

  console.log('');
  if (failures.length) {
    console.error(`✖ Smoke test failed: ${failures.length} of ${total} checks.`);
    process.exit(1);
  }
  console.log(`✓ Smoke test passed: ${total}/${total} checks.`);
}

main().catch((error) => {
  console.error(`✖ Smoke test crashed: ${error.stack || error.message}`);
  process.exit(1);
});
