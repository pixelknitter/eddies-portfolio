import { defineConfig, devices } from '@playwright/test';

/**
 * E2E configuration for the portfolio.
 *
 * Tests run against the Astro dev server by default. Set E2E_BASE_URL to point
 * them at a deployed environment instead — the same specs then act as a
 * post-deploy behavioural check against a preview or staging URL.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:4321';

// Only manage a server when testing locally; a deployed target is already up.
const isLocal = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './src/e2e',
  // Fail the build if a `test.only` is committed.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Serial locally keeps the shared dev server predictable; CI has the cores.
  workers: process.env.CI ? 2 : 1,
  reporter: process.env.CI
    ? [
        ['github'],
        [
          'html',
          { outputFolder: '../../dist/playwright-report', open: 'never' },
        ],
      ]
    : [['list']],

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Cloudflare Access protects preview/staging; a service token lets the
    // suite through without a browser login.
    extraHTTPHeaders:
      process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET
        ? {
            'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
            'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET,
          }
        : {},
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Mobile viewport catches the responsive navigation and grid collapse.
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],

  webServer: isLocal
    ? {
        // Builds and serves the real Worker rather than the Vite dev server.
        //
        // `astro dev` cannot be used here: it manages a background daemon,
        // and in some environments forces background mode outright, so
        // Playwright only ever saw the process exit. Serving the build also
        // exercises the same artifact that deploys — closer to production
        // than a dev server.
        //
        // Feature flags are on so the suite can exercise every section;
        // production gating is asserted separately by the smoke test.
        command:
          // Sections are enabled so the suite can reach them, but
          // PUBLIC_SHOW_UNPUBLISHED stays off deliberately: the suite asserts
          // production publication rules, and drafts must not be reachable.
          // PUBLIC_SHOW_FIXTURES is required, not incidental: this build has no seal
          // key, so sample-*.md is the only content that exists to assert on.
          // PUBLIC_RESUME_PRINT is deliberately absent, so the suite can prove the
          // print routes 404 in a normal build. They render the resume *with*
          // contact details, and only the PDF generator should ever reach them.
          'PUBLIC_SHOW_BLOG=true PUBLIC_SHOW_PROJECTS=true PUBLIC_SHOW_AIR=true ' +
          'PUBLIC_SHOW_FIXTURES=true PUBLIC_SHOW_RESUME=true ' +
          'yarn astro build && ' +
          // Test-only secrets, so the download flow is exercisable end to end. The
          // webhook points at a local sink the resume spec starts; without a value
          // the request endpoint would still succeed but report notified: false.
          'npx wrangler dev -c dist/server/wrangler.json --port 4321 --local ' +
          '--var AIR_SIGNING_SECRET:e2e-not-a-secret ' +
          '--var DISCORD_ACCESS_WEBHOOK_URL:http://127.0.0.1:4399/sink',
        url: baseURL,
        cwd: '../web-astro',
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        /*
         * Keep wrangler's own output. This is not a convenience — it is the
         * only record of why the server went away.
         *
         * The suite fails intermittently with every remaining test reporting
         * ERR_CONNECTION_REFUSED, because `wrangler dev` exits partway through
         * the run. It has happened on master as well as on feature branches,
         * and the point it dies moves between runs.
         *
         * Playwright defaults `stdout` to "ignore" and only pipes `stderr`.
         * Wrangler writes its diagnostics — the `✘ [ERROR]` block and the path
         * to its own logfile — to stdout, so the useful half was being dropped
         * on the floor while the empty error line on stderr was kept. That is
         * why a failure has never once said what happened.
         */
        stdout: 'pipe',
        stderr: 'pipe',
      }
    : undefined,
});
