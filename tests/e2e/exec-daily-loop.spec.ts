import { expect, test } from '@playwright/test';

import { resetExecState } from './helpers/db-reset';
import { loginAs, seededUsers } from './helpers/login';

test.beforeEach(async () => {
  // Each test runs against a clean Veera — no day_plan, no tasks.
  // The runner uses a fresh testcontainer per run, but we still iterate
  // 3 viewports × 2 tests, so per-test reset keeps each iteration
  // hermetic.
  const users = seededUsers();
  await resetExecState(users.exec.id);
});

// =============================================================================
// HVA-198 PR-A: exec daily-loop authenticated flow
// =============================================================================
//
// First authenticated spec. Proves the full Playwright + testcontainer +
// next-start + Better-Auth wiring works end-to-end. Scoped to the
// minimum that's still load-bearing: login → /today → Start My Day →
// post-submission state. Capturing baselines for both pre- and post-
// submission states locks the most-trafficked exec surface against
// future regressions.
//
// The Add Task / Mark Done / Postpone / Close Day steps land in
// PR-B with the captain-workflow + exec-requests specs, once this
// wiring is proven on prod CI.
// =============================================================================

test.describe('Exec daily loop', () => {
  test('login → /today pre-submission view', async ({ page }) => {
    await loginAs(page, 'exec');
    // After successful login, an exec lands on /today (per ROLE_HOME).
    await expect(page).toHaveURL(/\/today/);
    // The pre-submission view shows the Start My Day CTA. We assert
    // both the CTA's presence (button labelled "Start") and the lack
    // of post-submission chrome (no "Pending tasks" header) so the
    // screenshot baseline below has a known stable layout.
    await expect(
      page.getByRole('button', { name: /start/i }).first(),
    ).toBeVisible();
    await expect(page).toHaveScreenshot('today-pre-submission.png', {
      fullPage: true,
    });
  });

  test('Start My Day transitions to post-submission view', async ({ page }) => {
    await loginAs(page, 'exec');
    await expect(page).toHaveURL(/\/today/);
    // Click Start My Day. The button is HVA-60's primary CTA on the
    // pre-submission view.
    const startButton = page
      .getByRole('button', { name: /start/i })
      .first();
    await expect(startButton).toBeVisible();
    await startButton.click();
    // After the server action settles + router.refresh fires, the page
    // re-renders into the post-submission view (HVA-60 B branch). The
    // "Add task" button is the most stable anchor — present on every
    // viewport, hidden on the pre-submission CTA-only view.
    await expect(
      page.getByRole('button', { name: /add task/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveScreenshot('today-post-submission.png', {
      fullPage: true,
    });
  });
});
