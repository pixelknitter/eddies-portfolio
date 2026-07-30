import { test, expect, type APIRequestContext } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The resume, end to end against a real Worker.
 *
 * The assertions worth reading first are the two negatives: that no PDF is
 * reachable without a token, and that the print routes 404 in a normal build.
 * Everything else about the feature is a convenience; those two are the gate.
 */

/** Collects the Discord payloads the request endpoint fires. */
let sink: Server | undefined;
let received: unknown[] = [];

test.beforeAll(async () => {
  received = [];
  // playwright.config.ts points DISCORD_ACCESS_WEBHOOK_URL here, so the lead-capture
  // path is exercised without real Discord traffic and without a real secret.
  sink = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      try {
        received.push(JSON.parse(body));
      } catch {
        received.push(body);
      }
      response.writeHead(204).end();
    });
  });
  await new Promise<void>((done) => sink!.listen(4399, '127.0.0.1', done));
});

test.afterAll(async () => {
  await new Promise<void>((done) => sink?.close(() => done()));
});

test.describe('the resume pages', () => {
  test('renders collapsed, with every section present but closed', async ({
    page,
  }) => {
    await page.goto('/air/resume/');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Eddie Freeman' }),
    ).toBeVisible();

    const sections = page.locator('details.resume-section');
    await expect(sections).not.toHaveCount(0);
    // Collapsed is the decision; the content is still in the DOM for crawlers.
    expect(await sections.locator('[open]').count()).toBe(0);
  });

  test('expands and collapses every section from one control', async ({
    page,
  }) => {
    await page.goto('/air/resume/');

    const toggle = page.locator('[data-resume-expand]');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveText(/collapse all/i);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  // The premise of the whole feature: the page publishes no way to contact him
  // except the request form.
  test('publishes no contact details', async ({ page }) => {
    await page.goto('/air/resume/');
    const html = await page.content();

    expect(html).not.toMatch(/mailto:/);
    expect(html).not.toMatch(/[\w.-]+@[\w.-]+\.\w{2,}/);
    expect(html).not.toMatch(/\+?\d{3}[\s.-]\d{3}[\s.-]\d{4}/);
  });

  test('serves a machine-readable version with a contact-free JSON-LD graph', async ({
    page,
  }) => {
    await page.goto('/air/resume/for-bots');

    const raw = await page
      .locator('script[type="application/ld+json"]')
      .textContent();
    expect(raw).toBeTruthy();
    const graph = JSON.parse(raw!);

    expect(graph['@type']).toBe('ProfilePage');
    const person = graph.mainEntity;
    expect(person['@type']).toBe('Person');
    expect('email' in person).toBe(false);
    expect('telephone' in person).toBe(false);
    // Absolute and always production, so staging cannot publish a rival profile.
    expect(person.url).toBe('https://eddie.engineering');
  });
});

test.describe('the download gate', () => {
  /*
   * One project only. These are API assertions over `request` — no page, no
   * viewport — so running them under both projects doubles the traffic and proves
   * nothing extra. It doubled it into the rate limiter: the request endpoint allows
   * 5 per 10 minutes per client IP, this suite makes 4 POSTs, and both projects
   * share the runner's IP. CI failed with 429 while `--project=chromium` locally
   * passed, which is the whole reason to say this out loud.
   */
  // `isMobile` rather than the project name: a describe-level skip condition is
  // handed the fixtures, not testInfo, so `testInfo.project` is undefined there —
  // which failed as "cannot read properties of undefined" on the first attempt.
  test.skip(
    ({ isMobile }) => Boolean(isMobile),
    'API-level assertions; viewport is irrelevant and a second run only burns rate limit',
  );

  /*
   * These four tests share one rate-limit bucket, and that cannot be worked around
   * here: the endpoint reads `cf-connecting-ip` before `x-forwarded-for`, and
   * `wrangler dev` supplies the former on every request — so a spoofed
   * `x-forwarded-for` is never consulted. An earlier version of this file set one
   * and appeared to isolate the tests while doing nothing.
   *
   * The endpoint allows 5 per 10 minutes. Four requests below, one slot spare. Adding
   * a fifth means raising `limit` in the endpoint or splitting this file — not adding
   * a header. The limiter itself is asserted deterministically against
   * `createRateLimiter` in air.spec.ts, with an injected clock.
   */

  /**
   * Guessing paths can only find files someone thought to name, so this pairs a
   * URL sweep with a walk of the built asset tree that reads magic bytes. The
   * second is the one that cannot be fooled by a filename nobody predicted.
   */
  test('exposes no PDF at any public URL', async ({ request }) => {
    for (const path of [
      '/resume.pdf',
      '/Eddie-Freeman-Resume.pdf',
      '/Eddie-Freeman-Resume-ATS.pdf',
      '/resume/human.pdf',
      '/air/resume/resume.pdf',
      '/_astro/resume.pdf',
      '/assets/resume.pdf',
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
    }
  });

  test('ships nothing PDF-shaped in the public asset tree', () => {
    // cwd is packages/web-astro-e2e when Playwright runs.
    const client = resolve('../web-astro/dist/client');
    if (!existsSync(client)) test.skip(true, 'no build output to inspect');

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry);
        return statSync(path).isDirectory() ? walk(path) : [path];
      });

    for (const file of walk(client)) {
      expect(
        file.toLowerCase(),
        'a PDF is in the public asset tree',
      ).not.toMatch(/\.pdf$/);
      expect(
        readFileSync(file).subarray(0, 5).toString('latin1'),
        `${file} has PDF magic bytes`,
      ).not.toBe('%PDF-');
    }
  });

  // These render the resume *with* contact details as parseable HTML — a strictly
  // better leak than the PDF. The config deliberately omits PUBLIC_RESUME_PRINT.
  test('keeps the print render routes unreachable in a normal build', async ({
    request,
  }) => {
    for (const path of ['/air/resume/print/human', '/air/resume/print/bot']) {
      expect((await request.get(path)).status(), path).toBe(404);
    }
  });

  test('refuses a download with no token, and does not answer with a PDF', async ({
    request,
  }) => {
    const response = await request.get('/api/resume/download?format=human');
    expect(response.status()).toBe(403);
    expect(response.headers()['content-type']).not.toContain('application/pdf');
  });

  test('refuses a forged token', async ({ request }) => {
    const response = await request.get(
      '/api/resume/download?format=human&token=not-a-token',
    );
    expect(response.status()).toBe(403);
  });

  test('requires a note, not just an address', async ({ request }) => {
    const response = await request.post('/api/resume/request', {
      data: { email: 'jane@acme.com', reason: 'hi' },
    });
    expect(response.status()).toBe(400);
  });

  /**
   * The assertion that covers the entire pipeline in one line: the served bytes
   * contain the requester's address. That is only true if generation, the
   * uncompressed watermark slot, the recorded offsets, token minting, verification
   * and the byte patch all work.
   */
  test('serves a watermarked PDF naming the requester', async ({ request }) => {
    const email = `e2e-${Date.now()}@example.test`;

    const requested = await request.post('/api/resume/request', {
      data: {
        email,
        reason: 'End-to-end test of the lead capture flow and the watermark.',
        format: 'human',
      },
    });
    expect(requested.status()).toBe(200);

    const body = await requested.json();
    expect(body.ok).toBe(true);
    expect(body.downloads).toHaveLength(1);

    const download = await request.get(body.downloads[0].url);
    expect(download.status()).toBe(200);
    expect(download.headers()['content-type']).toBe('application/pdf');
    expect(download.headers()['content-disposition']).toContain('attachment');
    // Personalised bytes must never sit in a shared cache.
    expect(download.headers()['cache-control']).toContain('no-store');

    const pdf = await download.body();
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain(email);
    // The placeholder must be gone, or the patch silently did nothing.
    expect(pdf.toString('latin1')).not.toContain('#'.repeat(78));

    // And the lead was recorded.
    await expect.poll(() => JSON.stringify(received)).toContain(email);
  });

  test('will not let a token fetch a format it was not issued for', async ({
    request,
  }) => {
    const requested = await request.post('/api/resume/request', {
      data: {
        email: 'crossformat@example.test',
        reason: 'Checking that a bot token cannot fetch the human PDF.',
        format: 'bot',
      },
    });
    expect(
      requested.status(),
      'the request must succeed before the token can be tested',
    ).toBe(200);
    const body = await requested.json();
    const token = new URL(
      body.downloads[0].url,
      'http://localhost',
    ).searchParams.get('token');

    const wrong = await request.get(
      `/api/resume/download?format=human&token=${token}`,
    );
    expect(wrong.status()).toBe(403);

    const right = await request.get(
      `/api/resume/download?format=bot&token=${token}`,
    );
    expect(right.status()).toBe(200);
  });

  // Replay inside the window is intended, for the reason requests.mjs documents:
  // the common failure is "the download did not start", and a second click should
  // fix that rather than need a whole new request.
  test('allows the same link to be used twice inside its window', async ({
    request,
  }: {
    request: APIRequestContext;
  }) => {
    const requested = await request.post('/api/resume/request', {
      data: {
        email: 'replay@example.test',
        reason: 'Confirming a link survives a second click.',
        format: 'human',
      },
    });
    expect(requested.status()).toBe(200);
    const { downloads } = await requested.json();

    expect((await request.get(downloads[0].url)).status()).toBe(200);
    expect((await request.get(downloads[0].url)).status()).toBe(200);
  });
});
