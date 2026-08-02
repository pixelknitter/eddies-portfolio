import { expect, type Locator, type Page } from '@playwright/test';

/** The dialog panel, not the overlay wrapper. */
export const dialog = '[role="dialog"]';

/**
 * Open a modal and wait for it to stop moving.
 *
 * The panel enters on `lift-in` — 180ms translating 12px up to rest. Playwright
 * clicks and fills faster than that, so a `boundingBox()` taken straight after
 * the opener samples the panel mid-flight: every box inside it reads ~9px low,
 * with the fractional coordinates that give an in-progress transform away.
 *
 * That is not a layout bug and no user can hit it — reaching the submit button
 * means typing an email and a reason first, which takes far longer than the
 * animation. But it made two geometry assertions fail as though the layout were
 * shifting, and cost a full debugging session chasing a box that was never
 * growing. Settling here means a dialog test measures the resting layout, which
 * is the only thing it ever meant to measure.
 *
 * Deliberately *not* solved with `reducedMotion: 'reduce'` in the config: every
 * animation is gated on `motion-safe:`, so that would switch off the entry the
 * suite exists to exercise.
 */
export async function openDialog(page: Page, opener: Locator): Promise<Locator> {
  await opener.click();

  const panel = page.locator(dialog);
  await expect(panel).toBeVisible();
  await settleDialog(panel);

  return panel;
}

/**
 * Wait out any animation currently running on the panel.
 *
 * Separate from `openDialog` because a panel can also animate when it is
 * already open — a swap between the code prompt and the question view runs the
 * same entry.
 */
export async function settleDialog(panel: Locator): Promise<void> {
  await panel.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}
