import { test, expect } from '@playwright/test';

test.describe('routes', () => {
  test('home renders the author and the building blocks', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/Engineering by Eddie/i);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'My Building Blocks' })
    ).toBeVisible();
  });

  test('blog index lists posts that link to real pages', async ({ page }) => {
    await page.goto('/blog/');

    await expect(page.getByRole('heading', { name: 'Blog', exact: true })).toBeVisible();

    const postLinks = page.locator('a[href^="/blog/"]');
    const count = await postLinks.count();
    expect(count).toBeGreaterThan(0);

    // Following the first card must land on a real post, not a 404.
    const href = await postLinks.first().getAttribute('href');
    const response = await page.goto(href!);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  });

  test('works index links through to a project page', async ({ page }) => {
    await page.goto('/works/');

    await expect(
      page.getByRole('heading', { name: 'Projects', exact: true })
    ).toBeVisible();

    const projectLinks = page.locator('a[href^="/projects/"]');
    expect(await projectLinks.count()).toBeGreaterThan(0);

    const href = await projectLinks.first().getAttribute('href');
    const response = await page.goto(href!);
    expect(response?.status()).toBe(200);
  });

  test('unknown routes return 404', async ({ page }) => {
    const response = await page.goto('/this-route-should-not-exist');
    expect(response?.status()).toBe(404);
  });

  test('external links open safely', async ({ page }) => {
    await page.goto('/');
    const external = page.locator('a[target="_blank"]');

    // Any new-tab link must carry noopener, or the opened page can reach back
    // via window.opener.
    for (let i = 0; i < (await external.count()); i++) {
      const rel = (await external.nth(i).getAttribute('rel')) ?? '';
      expect(rel, `link ${i} is missing rel=noopener`).toContain('noopener');
    }
  });
});
