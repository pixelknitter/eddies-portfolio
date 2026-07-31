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

// Set on production deploys: assert that feature-flagged sections are NOT
// exposed. Without this the suite only proves what *is* live, never what
// should stay hidden.
const strictFlags = process.env.SMOKE_STRICT_FLAGS === 'true';

const REQUEST_TIMEOUT_MS = 20_000;
const RETRIES = 3;

/**
 * Routes behind a feature flag. Review tiers switch the flags on and must
 * serve these; production leaves them off and must not serve them at all.
 *
 * Asserting a flat 200 here is what made this suite contradict itself once
 * the flags started gating routes rather than only nav links.
 */
const gatedRoutes = [
  { path: '/blog/', contains: 'Blog' },
  { path: '/works/', contains: 'Projects' },
  // No hardcoded project slug: the four `project-N` pages were placeholders and
  // are now `sample-*`, which loads only behind PUBLIC_SHOW_FIXTURES. A fixed
  // URL here asserted a route the site had deliberately stopped serving. The
  // detail page is reached by following the index instead, below.
  // A.I.R. is flag-gated like the rest. It was exempt while production built
  // with PUBLIC_SHOW_AIR=true and leaned on the access code alone — but the
  // page and its nav link were still reachable by anyone.
  { path: '/air/' },
  // The resume is no longer here: it ships on every tier, so it is asserted
  // live in `checks` below rather than asserted absent in strict mode. It rode
  // its own flag precisely so it could go live without A.I.R., and it has.
];

/** Routes asserted on every deploy. `contains` is checked case-sensitively. */
const checks = [
  { path: '/', status: 200, contains: 'Engineering by Eddie' },
  // Unknown routes must 404 rather than render a page or error.
  { path: '/this-route-should-not-exist', status: 404 },
  // Asserted on **every** tier, not only in strict mode, because these are the
  // gate rather than a feature. The print routes render the resume with contact
  // details, and a PDF at a public path would make the download token
  // decoration — and the asset handler's real behaviour only exists at the edge,
  // so a local check cannot stand in for this.
  { path: '/air/resume/print/human', status: 404 },
  { path: '/air/resume/print/bot', status: 404 },
  { path: '/Eddie-Freeman-Resume.pdf', status: 404 },
  { path: '/resume.pdf', status: 404 },
  // Live on every tier, production included — the resume is what the site is
  // for. Asserted positively here rather than as a gated route, so a deploy
  // that quietly stops serving it fails instead of passing by omission.
  { path: '/air/resume/', status: 200, contains: 'Eddie Freeman' },
  { path: '/air/resume/for-bots', status: 200, contains: 'Eddie Freeman' },
  ...gatedRoutes.map(({ path, contains }) =>
    strictFlags ? { path, status: 404 } : { path, status: 200, contains }
  ),
];

/**
 * Sections that must stay hidden when their flag is off. Checked only in
 * strict mode, so review tiers — which deliberately enable them — still pass.
 */
const flaggedSections = [
  { name: 'blog', href: '/blog/' },
  { name: 'works', href: '/works/' },
  // The nav link, not just the route: a 404 at /air/ with a link still pointing
  // at it is how an unfinished section gets found.
  { name: 'air', href: '/air/' },
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

      // A 5xx immediately after a deploy is usually propagation, not a real
      // fault: the entry Worker answers before its assets are fully
      // available, so routes that read them fail briefly. Retry those rather
      // than failing the deploy on a race. 4xx is definitive — an expected
      // 404 check must not be retried into a timeout.
      if (response.status >= 500 && attempt < RETRIES) {
        const delay = attempt * 5000;
        console.log(`  … ${url} returned ${response.status}, retrying in ${delay}ms`);
        await sleep(delay);
        continue;
      }

      return { response, body };
    } catch (error) {
      lastError = error;
      // A freshly published deployment can take a moment to become routable.
      if (attempt < RETRIES) {
        const delay = attempt * 3000;
        console.log(`  … ${url} failed (${error.message}), retrying in ${delay}ms`);
        await sleep(delay);
      }
    }
  }
  if (lastError) throw lastError;
  // Exhausted retries on a persistent 5xx — report it as the real result.
  return fetch(url, {
    headers: headers(),
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).then(async (response) => ({ response, body: await response.text() }));
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
  if (strictFlags) {
    console.log('… blog is gated off in this tier; skipping the post-page check.');
  } else {
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

    // Same reasoning for projects, and the same tolerance for an empty index:
    // every project is currently a fixture, so the collection is legitimately
    // empty. Skipping is correct; a hard 200 was what broke this deploy.
    try {
      const index = await fetchWithRetry(`${baseUrl}/works/`);
      const slug = /href="\/projects\/([^"/]+)\/?"/.exec(index.body)?.[1];

      if (!slug) {
        console.log('… no projects listed; skipping the project-page check.');
      } else {
        extra += 1;
        const project = await fetchWithRetry(`${baseUrl}/projects/${slug}/`);
        if (project.response.status === 200) {
          console.log(`✓ /projects/${slug}/ — 200 (first listed project)`);
        } else {
          failures.push(`/projects/${slug}/ — expected HTTP 200, got ${project.response.status}`);
          console.log(
            `✖ /projects/${slug}/ — expected HTTP 200, got ${project.response.status}`
          );
        }
      }
    } catch (error) {
      failures.push(`works index — ${error.message}`);
      console.log(`✖ works index — ${error.message}`);
    }
  }

  // Negative assertions: prove the unfinished sections are not reachable and
  // not advertised. A passing positive suite says nothing about this.
  if (strictFlags) {
    console.log('');
    console.log('Strict flag mode — asserting gated sections stay hidden.');

    let home = '';
    try {
      home = (await fetchWithRetry(`${baseUrl}/`)).body;
    } catch (error) {
      failures.push(`home page — ${error.message}`);
    }

    for (const section of flaggedSections) {
      extra += 1;
      const linked = home.includes(`href="${section.href}"`);
      if (linked) {
        const problem = `${section.name} is linked from the nav but should be hidden`;
        failures.push(problem);
        console.log(`✖ ${problem}`);
        continue;
      }
      console.log(`✓ ${section.name} not linked (${section.href})`);
    }
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
