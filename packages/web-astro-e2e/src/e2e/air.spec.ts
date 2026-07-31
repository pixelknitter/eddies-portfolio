import { test, expect } from '@playwright/test';

/**
 * The A.I.R. access flow, step by step.
 *
 * ## Why the network is stubbed here
 *
 * This suite builds with no seal key and no Worker secrets, so the real
 * endpoints answer "available by invitation" and 503 — which is correct
 * behaviour for an unconfigured environment, and useless for exercising the
 * happy path. Stubbing the two endpoints lets every UI step be asserted
 * deterministically and offline.
 *
 * The server halves are covered where they can be checked properly:
 *
 *   - token mint → verify → tamper → expiry  →  src/util/air/requests.spec.ts
 *   - retrieval, grounding, refusal           →  src/util/air/evals/offline.spec.ts
 *   - order of gates in the endpoint          →  src/util/air/air.spec.ts
 *
 * What no automated layer covers is the real Discord POST and the real email
 * send, because both need live credentials and a receiving inbox. Those are
 * verified by hand against staging, which has the secrets. Stating that plainly
 * matters more than pretending the coverage is complete: a green suite here
 * means the flow is wired correctly, not that Eddie received the message.
 */

const AIR = '/cv/air/';

/** The dialog panel, not the overlay wrapper. */
const dialog = '[role="dialog"]';

test.describe('A.I.R. access request', () => {
  test('the request form opens as an overlay rather than stacking below', async ({ page }) => {
    await page.goto(AIR);

    const box = await page.locator('#air-access').boundingBox();
    await page.getByRole('button', { name: /ask eddie for access/i }).click();

    const panel = page.locator(dialog);
    await expect(panel).toBeVisible();

    // The bug this replaces: the form rendered inline, so it appeared *below*
    // the access-code panel and pushed the page taller. An overlay must cover
    // the viewport instead, leaving the content behind it where it was.
    const overlay = page.locator('.fixed.inset-0');
    await expect(overlay).toBeVisible();

    const viewport = page.viewportSize()!;
    const panelBox = (await panel.boundingBox())!;
    expect(panelBox.y).toBeLessThan(viewport.height);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(viewport.height + 1);

    // Content behind the dialog has not moved.
    expect((await page.locator('#air-access').boundingBox())!.y).toBeCloseTo(box!.y, 0);
  });

  test('focus moves into the dialog and returns to the opener on close', async ({ page }) => {
    await page.goto(AIR);

    const opener = page.getByRole('button', { name: /ask eddie for access/i });
    await opener.click();

    await expect(page.locator('#air-request-email')).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.locator(dialog)).toHaveCount(0);

    // Without restoring focus, dismissing drops a keyboard user at the top of
    // the document with no idea where they were.
    await expect(opener).toBeFocused();
  });

  test('Tab stays inside the dialog', async ({ page }) => {
    await page.goto(AIR);
    await page.getByRole('button', { name: /ask eddie for access/i }).click();

    // Walk well past the number of controls in the form; every stop must remain
    // inside the panel. `aria-modal` promises exactly this, and the previous
    // inline markup promised it without delivering.
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.locator(dialog).evaluate(
        (panel, _) => panel.contains(document.activeElement),
        null
      );
      expect(inside, `focus escaped the dialog after ${i + 1} tabs`).toBe(true);
    }
  });

  test('clicking the backdrop closes it', async ({ page }) => {
    await page.goto(AIR);
    await page.getByRole('button', { name: /ask eddie for access/i }).click();

    // Click near the corner, not the centre. The backdrop spans the viewport but
    // the panel sits on top of its midpoint, so a plain click — even a forced
    // one — dispatches into the panel and closes nothing. The corner is backdrop
    // in both layouts (centred on desktop, bottom-anchored on mobile), so this
    // exercises real hit-testing rather than bypassing it.
    await page.getByRole('button', { name: 'Close' }).click({ position: { x: 4, y: 4 } });
    await expect(page.locator(dialog)).toHaveCount(0);
  });

  test('the page behind the dialog cannot scroll', async ({ page }) => {
    await page.goto(AIR);
    await page.getByRole('button', { name: /ask eddie for access/i }).click();

    await expect
      .poll(() => page.evaluate(() => document.body.style.overflow))
      .toBe('hidden');

    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });

  test('a rejected request reports why without shifting the layout', async ({ page }) => {
    await page.route('**/api/air/request', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Requests are not open right now. Try again later.' }),
      })
    );

    await page.goto(AIR);
    await page.getByRole('button', { name: /ask eddie for access/i }).click();

    await page.locator('#air-request-email').fill('someone@example.com');
    await page.locator('#air-request-reason').fill('Hiring for a platform role.');

    const submit = page.getByRole('button', { name: /send request/i });
    const before = (await submit.boundingBox())!;

    await submit.click();
    await expect(page.getByText(/requests are not open right now/i)).toBeVisible();

    // The flicker: the button relabelled to "Sending…" and the message mounted
    // underneath, so the button and the Cancel link next to it jumped. Both the
    // reserved message space and the button's min-width exist to hold this
    // still.
    const after = (await submit.boundingBox())!;
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
    expect(after.width).toBeCloseTo(before.width, 0);
  });

  test('a successful request confirms, and reopening does not show the stale result', async ({
    page,
  }) => {
    await page.route('**/api/air/request', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Sent. Eddie will take a look.' }),
      })
    );

    await page.goto(AIR);
    const opener = page.getByRole('button', { name: /ask eddie for access/i });
    await opener.click();

    await page.locator('#air-request-email').fill('someone@example.com');
    await page.locator('#air-request-reason').fill('Curious about the platform work.');
    await page.getByRole('button', { name: /send request/i }).click();

    await expect(page.getByText(/sent\. eddie will take a look/i)).toBeVisible();

    // The confirmation replaces the form. Leaving a live "Send request" button
    // on screen after a successful send invites a second submission and reads as
    // though the first had not landed.
    await expect(page.getByRole('heading', { name: /request sent/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /send request/i })).toHaveCount(0);
    await expect(page.locator('#air-request-email')).toHaveCount(0);

    // And it offers a way out that is not "Cancel", which would imply undoing
    // something that has already happened.
    const done = page.getByRole('button', { name: /^done$/i });
    await expect(done).toBeVisible();
    await done.click();
    await expect(page.locator(dialog)).toHaveCount(0);

    await opener.click();

    // Reopening shows the form again, not the previous outcome — a stale
    // confirmation reads as a response to a request that was never sent.
    await expect(page.locator('#air-request-email')).toBeVisible();
    await expect(page.getByText(/sent\. eddie will take a look/i)).toHaveCount(0);
  });
});

test.describe('A.I.R. asking', () => {
  test('a wrong access code is reported and no answer is shown', async ({ page }) => {
    await page.goto(AIR);

    await page.locator('#air-access').fill('not-the-code');
    await page.locator('#air-question').fill('What has Eddie built?');
    await page.locator('#air-question').press('Enter');

    // The unconfigured build answers this for real — no stub needed, and it is
    // the same shape of response a wrong code produces in production.
    await expect(page.getByText(/available by invitation|invitation|access/i).first()).toBeVisible();
    await expect(page.locator('text=Drawn from')).toHaveCount(0);
  });

  test('an answer renders its sources', async ({ page }) => {
    await page.route('**/api/air/ask', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'He extracted the platform onto owned infrastructure.',
          grounded: true,
          sources: [{ id: 'platform-extraction', title: 'Platform Extraction' }],
        }),
      })
    );

    await page.goto(AIR);
    await page.locator('#air-question').fill('How does Eddie approach owning a system?');
    await page.locator('#air-question').press('Enter');

    await expect(page.getByText(/extracted the platform onto owned infrastructure/i)).toBeVisible();
    await expect(page.getByText('Drawn from')).toBeVisible();
    await expect(page.getByText('Platform Extraction')).toBeVisible();
  });

  test('an ungrounded answer says so instead of implying evidence', async ({ page }) => {
    await page.route('**/api/air/ask', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          answer: 'That is not something the stories cover.',
          grounded: false,
          sources: [],
        }),
      })
    );

    await page.goto(AIR);
    await page.locator('#air-question').fill('What is his favourite restaurant?');
    await page.locator('#air-question').press('Enter');

    await expect(page.getByText(/treat it as a gap rather than an assessment/i)).toBeVisible();
    await expect(page.getByText('Drawn from')).toHaveCount(0);
  });
});
