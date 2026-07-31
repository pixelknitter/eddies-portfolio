#!/usr/bin/env node
/**
 * Accessibility audit.
 *
 * Walks every route in both themes and scans the rendered page with axe-core.
 * Exists because the theming work is a correctness exercise, not an aesthetic
 * one: "this looks a bit low contrast" is an opinion, and a WCAG ratio at a
 * real element is not.
 *
 * Usage:
 *   node scripts/a11y-audit.mjs                      # scan, print, exit 1 on violations
 *   node scripts/a11y-audit.mjs --json report.json   # also write the full result
 *   A11Y_BASE_URL=http://localhost:4321 node scripts/a11y-audit.mjs
 *
 * It needs a server serving *fixture* content, because the real posts are
 * sealed and a scan can only see elements that exist:
 *
 *   cd packages/web-astro && PUBLIC_SHOW_BLOG=true PUBLIC_SHOW_PROJECTS=true \
 *     PUBLIC_SHOW_AIR=true PUBLIC_SHOW_RESUME=true PUBLIC_SHOW_FIXTURES=true \
 *     yarn astro dev
 *
 * A script rather than an e2e spec, deliberately and for now. The Playwright
 * suite's server dies mid-run (#52), and folding a fresh audit into a suite
 * that already flakes would make every real finding arguable. Promoting this
 * to a spec that fails CI is the first task of the testing phase, once #52 is
 * understood.
 *
 * Scope: axe catches roughly a third of WCAG issues automatically. It
 * supplements the hand-written checks in content.spec.ts; it does not replace
 * them, and a clean report here is not a claim that the site is accessible.
 */

import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFileSync } from 'node:fs';

const baseUrl = (
  process.env.A11Y_BASE_URL ||
  process.argv.find((a) => a.startsWith('http')) ||
  'http://localhost:4321'
).replace(/\/$/, '');

const jsonFlagIndex = process.argv.indexOf('--json');
const jsonPath = jsonFlagIndex === -1 ? null : process.argv[jsonFlagIndex + 1];

/**
 * The rule sets to check. WCAG 2.0 and 2.1, levels A and AA — the conformance
 * target the rest of the site is held to.
 *
 * Deliberately not including `best-practice`: those are opinions axe holds,
 * not conformance failures, and mixing them in makes a real violation
 * indistinguishable from a style note.
 */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Routes worth scanning, one per template that can render differently.
 *
 * `prepare` runs after navigation and before the scan. axe only sees what is
 * rendered, so anything behind a disclosure has to be opened first or it is
 * silently excluded from the audit — a clean report on a collapsed page means
 * nothing.
 */
const ROUTES = [
  { path: '/', name: 'home' },
  { path: '/blog/', name: 'blog index' },
  {
    path: '/blog/sample-markdown-kitchen-sink/',
    name: 'blog post (kitchen sink)',
  },
  { path: '/works/', name: 'works index' },
  { path: '/projects/sample-project-1/', name: 'project detail' },
  { path: '/air/', name: 'A.I.R.' },
  {
    path: '/air/resume/',
    name: 'resume',
    // Every section is a closed <details>. Expand them all, or the audit reads
    // one heading and calls the page clean.
    prepare: async (page) => {
      const toggle = page.locator('[data-resume-expand]');
      if ((await toggle.count()) > 0) {
        await toggle.first().click();
        await page
          .locator('details.resume-section[open]')
          .first()
          .waitFor({ state: 'attached', timeout: 5_000 })
          .catch(() => {});
      }
    },
  },
  { path: '/404', name: '404' },
];

const THEMES = ['light', 'dark'];

/**
 * Scan one route in one theme.
 *
 * The theme is seeded into localStorage *before* navigation rather than by
 * clicking the toggle afterwards. Layout.astro applies the theme from
 * localStorage in an inline script during first paint, so seeding it
 * reproduces what a returning visitor actually sees. Clicking after load would
 * scan a page that painted in the other theme first.
 */
async function scan(context, { path, name, prepare }, theme) {
  const page = await context.newPage();

  await page.addInitScript((value) => {
    window.localStorage.setItem('theme', value);
  }, theme);

  const response = await page.goto(`${baseUrl}${path}`, {
    waitUntil: 'load',
    timeout: 30_000,
  });

  const status = response?.status() ?? 0;

  // A 404 is expected on the /404 route and a bug anywhere else. Scanning an
  // error page by accident is how an audit comes back clean on nothing.
  const expected404 = path === '/404';
  if (!expected404 && status >= 400) {
    await page.close();
    return {
      route: name,
      path,
      theme,
      error: `HTTP ${status} — route did not render`,
      violations: [],
      incomplete: [],
    };
  }

  const appliedTheme = await page
    .locator('html')
    .evaluate((el) => (el.classList.contains('dark') ? 'dark' : 'light'));

  if (prepare) await prepare(page);

  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

  await page.close();

  return {
    route: name,
    path,
    theme,
    // Surfaced, not asserted: if the requested theme never applied, every
    // contrast number below describes the wrong page.
    appliedTheme,
    themeMismatch: appliedTheme !== theme,
    violations: results.violations.map(summarise),
    incomplete: results.incomplete.map(summarise),
  };
}

function summarise(result) {
  return {
    id: result.id,
    impact: result.impact,
    help: result.help,
    nodes: result.nodes.map((node) => ({
      target: node.target.join(' '),
      // axe's own explanation of the failure, which for contrast rules carries
      // the measured ratio and both colours.
      message: [...node.any, ...node.all, ...node.none]
        .map((check) => check.message)
        .join('; '),
    })),
  };
}

async function main() {
  const browser = await chromium.launch();
  // Scan with motion reduced, which the site already honours.
  //
  // Not a convenience: mid-animation an element is partly transparent, so axe
  // resolves a *composited* background and reports a ratio against a colour
  // that exists in no palette and at no other moment. Settling the page first
  // is the difference between measuring the design and measuring a frame of an
  // animation — and it audits what a motion-sensitive visitor actually gets.
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const reports = [];

  for (const route of ROUTES) {
    for (const theme of THEMES) {
      try {
        reports.push(await scan(context, route, theme));
      } catch (error) {
        reports.push({
          route: route.name,
          path: route.path,
          theme,
          error: error.message,
          violations: [],
          incomplete: [],
        });
      }
    }
  }

  await browser.close();

  const errored = reports.filter((r) => r.error);
  const mismatched = reports.filter((r) => r.themeMismatch);
  const withViolations = reports.filter((r) => r.violations.length > 0);
  const withIncomplete = reports.filter((r) => r.incomplete.length > 0);

  for (const report of reports) {
    const label = `${report.route} [${report.theme}]`;
    if (report.error) {
      console.log(`✖ ${label} — ${report.error}`);
      continue;
    }
    const v = report.violations.length;
    const i = report.incomplete.length;
    const mark = v > 0 ? '✖' : '✓';
    console.log(
      `${mark} ${label} — ${v} violation(s), ${i} needing review` +
        (report.themeMismatch ? `  ⚠ rendered as ${report.appliedTheme}` : ''),
    );
    for (const violation of report.violations) {
      console.log(`    ✖ [${violation.impact}] ${violation.id}: ${violation.help}`);
      for (const node of violation.nodes) {
        console.log(`        ${node.target}`);
        if (node.message) console.log(`          ${node.message}`);
      }
    }
  }

  // Reported apart from violations and never folded into the pass count. When
  // axe cannot resolve a background it says so by name — bgGradient, bgImage,
  // bgOverlap, pseudoContent, colorParse, elmPartiallyObscured — instead of
  // guessing. Those are the cases a hand-rolled ratio calculator gets
  // confidently wrong, so they are surfaced for a human to settle, one by one.
  if (withIncomplete.length > 0) {
    console.log('\n── needs review (axe could not decide; NOT a pass) ──');
    for (const report of withIncomplete) {
      for (const item of report.incomplete) {
        console.log(`  ? ${report.route} [${report.theme}] ${item.id}: ${item.help}`);
        for (const node of item.nodes) {
          console.log(`      ${node.target}`);
          if (node.message) console.log(`        ${node.message}`);
        }
      }
    }
  }

  const totalViolations = reports.reduce((n, r) => n + r.violations.length, 0);
  const totalIncomplete = reports.reduce((n, r) => n + r.incomplete.length, 0);

  console.log(
    `\n${reports.length} scans — ` +
      `${totalViolations} violation(s) across ${withViolations.length} page/theme pair(s), ` +
      `${totalIncomplete} item(s) needing review, ` +
      `${errored.length} scan error(s)`,
  );

  if (mismatched.length > 0) {
    console.log(
      `⚠ ${mismatched.length} scan(s) rendered in the other theme — their results describe the wrong page.`,
    );
  }

  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify(reports, null, 2));
    console.log(`→ wrote ${jsonPath}`);
  }

  // Violations and scan errors fail. Incomplete does not: it is a prompt to
  // look, and failing on it would train the reader to silence it.
  if (totalViolations > 0 || errored.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(`✖ audit could not run: ${error.message}`);
  process.exit(1);
});
