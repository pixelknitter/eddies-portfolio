import { test, expect } from '@playwright/test';

/**
 * The chooser and the variant routes.
 *
 * Runs against the built Worker with fixtures on, which is the only reason
 * these assertions are possible at all: the real resume is sealed and absent
 * from the repo, so `sample-solutions-*` is what makes a second variant exist
 * in CI. See playwright.config.ts for the flags the build is given.
 */

/** Scoped to the cards band, so the site chrome's own /cv links do not count. */
const CARDS = 'section[aria-labelledby="cv-versions"] a';

test.describe('the CV chooser', () => {
  test('asks what the visitor is hiring for', async ({ page }) => {
    await page.goto('/cv/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      /what are you hiring for/i,
    );
  });

  test('offers a card for every available variant', async ({ page }) => {
    await page.goto('/cv/');
    // product and solutions. Leadership is registered but unwritten.
    await expect(page.locator(CARDS)).toHaveCount(2);
  });

  test('leaves no card for a variant with no content', async ({ page }) => {
    await page.goto('/cv/');
    await expect(page.locator('a[href="/cv/leadership/"]')).toHaveCount(0);
  });

  // The failure this guards is a chooser that offers a framing nobody wrote.
  test('every card leads somewhere that answers', async ({ page }) => {
    await page.goto('/cv/');
    const hrefs = await page
      .locator(CARDS)
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLAnchorElement).getAttribute('href')),
      );

    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href, 'a card with no href').toBeTruthy();
      const response = await page.request.get(href as string);
      expect(response.status(), href as string).toBe(200);
    }
  });

  test('a card leads to that variant, not to the default', async ({ page }) => {
    await page.goto('/cv/');
    await page.locator('a[href="/cv/solutions/"]').click();

    await expect(page).toHaveURL(/\/cv\/solutions\/?$/);
    /*
     * The headline, not the h1. The h1 is the name and is the same on every
     * variant — which is the point: one person, several framings. The headline
     * is the first thing that differs.
     */
    await expect(page.locator('.resume-headline')).toContainText(
      /solutions engineer/i,
    );
  });

  // The chooser is the CV's front door now, so the premise the whole feature
  // rests on has to hold here too: no way to reach him but the request form.
  test('publishes no contact details', async ({ page }) => {
    await page.goto('/cv/');
    const html = await page.content();

    expect(html).not.toMatch(/mailto:/);
    expect(html).not.toMatch(/[\w.-]+@[\w.-]+\.\w{2,}/);
    expect(html).not.toMatch(/\+?\d{3}[\s.-]\d{3}[\s.-]\d{4}/);
  });

  test('says the answers come from a fixed record', async ({ page }) => {
    await page.goto('/cv/');
    await expect(page.locator('main')).toContainText(/nothing is invented/i);
  });
});

test.describe('the variant routes', () => {
  test('serves each variant its own framing', async ({ page }) => {
    await page.goto('/cv/product/');
    const product = await page.title();

    await page.goto('/cv/solutions/');
    const solutions = await page.title();

    expect(product).not.toBe(solutions);
    expect(solutions).toMatch(/solutions/i);
  });

  // Emphasis overrides are the whole reason experience stays single-source.
  test('applies the variant emphasis to a shared role', async ({ page }) => {
    await page.goto('/cv/solutions/');
    await expect(page.locator('main')).toContainText(
      /solutions-framed summary/i,
    );

    await page.goto('/cv/product/');
    await expect(page.locator('main')).not.toContainText(
      /solutions-framed summary/i,
    );
  });

  test('404s a registered variant that nobody has written', async ({
    page,
  }) => {
    expect((await page.request.get('/cv/leadership/')).status()).toBe(404);
  });

  test('404s a slug that is not registered', async ({ page }) => {
    expect((await page.request.get('/cv/nonsense/')).status()).toBe(404);
  });

  /*
   * Astro resolves static segments before dynamic ones. That is behaviour we
   * depend on rather than behaviour we control, so it is asserted: without it
   * `/cv/air` would be swallowed by `[variant].astro` and 404 as an
   * unregistered slug, turning a working page into a dead one.
   */
  test('leaves the sibling CV routes reachable', async ({ page }) => {
    for (const path of ['/cv/air/', '/cv/for-bots']) {
      expect((await page.request.get(path)).status(), path).toBe(200);
    }
  });
});

test.describe('the chooser seed questions', () => {
  const SEEDS = 'section[aria-labelledby="cv-seeds"] button';

  test('offers a question to start from', async ({ page }) => {
    await page.goto('/cv/');
    await expect(
      page.getByRole('heading', { name: /start with a question/i }),
    ).toBeVisible();
    await expect(page.locator(SEEDS).first()).toBeVisible();
  });

  // A seed that opens nothing is a dead button, which is worse than no button.
  test('opens A.I.R. on the question that was picked', async ({ page }) => {
    await page.goto('/cv/');

    const seed = page.locator(SEEDS).first();

    /*
     * Hover first, which pauses the rotation. Reading the question and then
     * clicking it is two steps, and a rotation landing between them asserts
     * against a question that is no longer on the card.
     */
    await seed.hover();
    // The question, without the decorative glyph beside it.
    const asked = (
      await seed.locator('span:not([aria-hidden])').innerText()
    ).trim();

    /*
     * Retried, because the island is `client:visible`. On a narrow viewport
     * these sit below the fold, so scrolling them into view is what starts
     * hydration — and a click that lands in the gap before React attaches is
     * swallowed silently. Retrying the click rather than only the assertion is
     * the difference between waiting for hydration and waiting forever.
     */
    const dialog = page.getByRole('dialog');
    await expect(async () => {
      await seed.click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15000 });

    // Prefilled, not sent: the visitor picked a starting point, not a wording.
    await expect(dialog.locator('input[type="text"]').first()).toHaveValue(
      asked,
    );
  });
});
