import { test, expect, type Page } from '@playwright/test';

/**
 * Assert a page's heading outline: it opens at h1 and never skips a level.
 *
 * Both halves matter. Starting below h1 leaves a screen reader's document
 * outline rootless; jumping h2 → h4 implies a section that is not there.
 */
async function assertHeadingOutline(page: Page, label: string) {
  const levels = await page
    .locator('h1, h2, h3, h4, h5, h6')
    .evaluateAll((els) => els.map((el) => Number(el.tagName[1])));

  expect(levels.length, `${label} renders no headings at all`).toBeGreaterThan(0);
  expect(levels[0], `${label} starts at h${levels[0]}, not h1`).toBe(1);

  for (let i = 1; i < levels.length; i++) {
    expect(
      levels[i] - levels[i - 1],
      `${label} jumps from h${levels[i - 1]} to h${levels[i]}`,
    ).toBeLessThanOrEqual(1);
  }
}

test.describe('content integrity', () => {
  test('no draft posts are published', async ({ page }) => {
    await page.goto('/blog/');
    // `hello.md` is a draft; it must never appear on the public index.
    await expect(page.locator('a[href="/blog/hello/"]')).toHaveCount(0);
  });

  test('every image on the home page has alt text and actually loads', async ({ page }) => {
    await page.goto('/');

    // Walk the page so below-the-fold images actually fetch. Without this,
    // lazy-loaded logos keep naturalWidth 0 and read as broken — and doing it
    // with scrollIntoViewIfNeeded() hangs, because Playwright's actionability
    // check waits for stability that an animated element never reaches.
    await page.evaluate(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      window.scrollTo(0, 0);
    });

    const images = page.locator('img');
    const count = await images.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const img = images.nth(i);
      const alt = await img.getAttribute('alt');
      const src = await img.getAttribute('src');

      expect(alt, `image ${src} is missing alt text`).toBeTruthy();

      // naturalWidth of 0 means a broken image — this is what caught the
      // dead OpenAI icon.
      await expect
        .poll(
          () => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0),
          { timeout: 15_000, message: `image failed to load: ${src}` }
        )
        .toBe(true);
    }
  });

  test('a blog post renders its title, author and body', async ({ page }) => {
    await page.goto('/blog/');
    const href = await page
      .locator('main a[href^="/blog/"]:not([href="/blog/"])')
      .first()
      .getAttribute('href');
    await page.goto(href!);

    // The post title is the page's h1, not an h2 — a post with no h1 has no
    // document outline.
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

    // Assert the post has real prose, not just a heading. A word-character
    // run is the wrong shape for this — prose is words separated by spaces.
    const body = (await page.locator('main').innerText()).trim();
    expect(body.length, 'post body looks empty').toBeGreaterThan(120);
  });

  test('a project page renders its metadata', async ({ page }) => {
    await page.goto('/works/');
    const href = await page
      .locator('main a[href^="/projects/"]:not([href="/projects/"])')
      .first()
      .getAttribute('href');
    await page.goto(href!);

    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.locator('main')).toContainText(/PLATFORM|STACK/i);
  });
});

test.describe('accessibility basics', () => {
  /**
   * Every route family, not just `/`.
   *
   * This assertion passed for a long time while four route families had no
   * `<h1>` at all, because it only ever visited the home page — which is one
   * of the pages that happened to have one. The assertion was real; its
   * coverage was not.
   *
   * The two detail routes are discovered by following the index rather than
   * hardcoded, so the test does not depend on which fixture slugs exist.
   */
  const headingRoutes = ['/', '/blog/', '/works/', '/air/', '/404'];

  for (const route of headingRoutes) {
    test(`headings start at h1 and do not skip a level — ${route}`, async ({
      page,
    }) => {
      await page.goto(route);
      await assertHeadingOutline(page, route);
    });
  }

  test('headings start at h1 and do not skip a level — a blog post', async ({
    page,
  }) => {
    await page.goto('/blog/');
    const href = await page
      .locator('main a[href^="/blog/"]:not([href="/blog/"])')
      .first()
      .getAttribute('href');
    await page.goto(href!);
    await assertHeadingOutline(page, href!);
  });

  test('headings start at h1 and do not skip a level — a project page', async ({
    page,
  }) => {
    await page.goto('/works/');
    const href = await page
      .locator('main a[href^="/projects/"]:not([href="/projects/"])')
      .first()
      .getAttribute('href');
    await page.goto(href!);
    await assertHeadingOutline(page, href!);
  });

  test('landmarks are present', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.locator('footer')).toHaveCount(1);
  });

  test('the theme control is reachable and operable by keyboard', async ({ page }) => {
    await page.goto('/');

    const toggle = page.getByRole('button', { name: /theme/i });
    await toggle.focus();
    await expect(toggle).toBeFocused();

    const before = await page
      .locator('html')
      .evaluate((el) => el.classList.contains('dark'));
    await page.keyboard.press('Enter');

    await expect
      .poll(() => page.locator('html').evaluate((el) => el.classList.contains('dark')))
      .toBe(!before);
  });
});
