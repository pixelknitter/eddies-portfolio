import { test, expect } from '@playwright/test';

/**
 * The theme toggle is the site's most stateful behaviour: it writes
 * localStorage, survives view transitions, and syncs across tabs via storage
 * events. Each of those is a separate failure mode, so each gets a test.
 */
test.describe('theme', () => {
  test('toggling flips the document class', async ({ page }) => {
    await page.goto('/');

    const html = page.locator('html');
    const startedDark = await html.evaluate((el) => el.classList.contains('dark'));

    await page.getByRole('button', { name: /theme/i }).click();

    await expect
      .poll(() => html.evaluate((el) => el.classList.contains('dark')))
      .toBe(!startedDark);
  });

  test('choice persists across a reload', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /theme/i }).click();
    const chosen = await page.evaluate(() => localStorage.getItem('theme'));
    expect(chosen === 'dark' || chosen === 'light').toBe(true);

    await page.reload();

    await expect
      .poll(() => page.locator('html').evaluate((el) => el.classList.contains('dark')))
      .toBe(chosen === 'dark');
  });

  test('choice survives client-side navigation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /theme/i }).click();
    const chosen = await page.evaluate(() => localStorage.getItem('theme'));

    // View transitions re-run the inline theme script; a regression here shows
    // up as a flash of the wrong theme after navigating.
    await page.goto('/blog/');

    await expect
      .poll(() => page.locator('html').evaluate((el) => el.classList.contains('dark')))
      .toBe(chosen === 'dark');
  });

  test('syncs across tabs', async ({ context }) => {
    const first = await context.newPage();
    const second = await context.newPage();
    await first.goto('/');
    await second.goto('/');

    const before = await second
      .locator('html')
      .evaluate((el) => el.classList.contains('dark'));

    await first.getByRole('button', { name: /theme/i }).click();

    // The listening tab reacts to the storage event without a reload.
    await expect
      .poll(
        () => second.locator('html').evaluate((el) => el.classList.contains('dark')),
        { timeout: 5000 }
      )
      .toBe(!before);
  });

  test('respects the system preference on a first visit', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    await page.goto('/');

    await expect
      .poll(() => page.locator('html').evaluate((el) => el.classList.contains('dark')))
      .toBe(true);

    await context.close();
  });
});
