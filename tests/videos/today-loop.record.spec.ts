import { test, expect, type Page } from '@playwright/test';

import { loginAs } from '../e2e/helpers/login';

// =============================================================================
// HVA-262: RECORDED WALKTHROUGH — the Today loop, for the exec manual
// =============================================================================
//
// This is not a test in the assertion sense — it's a camera operator.
// It drives the real app slowly enough for a human to follow, while
// Playwright records the viewport. The .webm lands in
// test-results/videos/**, and scripts/publish-videos.sh ships it next
// to the manual.
//
// Flow shown: login → Today → Start My Day → add a task → mark it done
// with an outcome → Close the Day.
//
// `pause()` calls are the "let the viewer read this screen" beats —
// tune them rather than slowMo if pacing feels off.
// =============================================================================

async function pause(page: Page, ms = 1400) {
  await page.waitForTimeout(ms);
}

test('today loop walkthrough', async ({ page }) => {
  // ---- login (recorded — execs should see what signing in looks like)
  await loginAs(page, 'exec');
  await pause(page);

  // ---- Today, pre-submission: Start My Day
  await page.goto('/today');
  await expect(
    page.getByRole('button', { name: /start my day/i }),
  ).toBeVisible({ timeout: 15_000 });
  await pause(page);
  await page.getByRole('button', { name: /start my day/i }).click();
  await pause(page, 2000);

  // ---- Add a task
  const addTask = page.getByRole('button', { name: /add task/i }).first();
  await expect(addTask).toBeVisible({ timeout: 15_000 });
  await addTask.click();
  await pause(page);

  // Pick the first task type chip, type a description, save.
  // (The sheet's type buttons render before the date + description.)
  const sheet = page.locator('[role="dialog"]');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button').first().click();
  await pause(page, 800);
  await page.locator('#add-task-description').fill('Call Mr. Sharma about curtain samples');
  await pause(page, 800);
  await sheet.getByRole('button', { name: /^add task$/i }).click();
  await pause(page, 2000);

  // ---- Mark it done with an outcome
  await page.getByRole('button', { name: /mark as done/i }).first().click();
  await pause(page);
  // Outcome chips appear inline; pick the first one. Free-text tasks
  // show a textarea + Confirm instead — handle both shapes.
  const confirm = page.getByRole('button', { name: /^confirm$/i });
  if (await confirm.isVisible().catch(() => false)) {
    await page
      .locator('textarea')
      .last()
      .fill('Customer confirmed — visiting Saturday 11 AM');
    await pause(page, 800);
    await confirm.click();
  } else {
    // chips mode — first outcome chip completes the task
    await page
      .locator('button', { hasText: /./ })
      .filter({ hasNot: page.locator('[aria-label]') })
      .first()
      .click()
      .catch(async () => {
        // fallback: click whatever buttons the expanded area shows
        await page.getByRole('button').nth(2).click();
      });
  }
  await pause(page, 2200);

  // ---- Close the Day
  await page.goto('/today/close');
  await expect(
    page.getByRole('button', { name: /close the day/i }),
  ).toBeVisible({ timeout: 15_000 });
  await pause(page, 1800);
  await page.getByRole('button', { name: /close the day/i }).click();
  await pause(page);
  // Confirm dialog
  const dialogConfirm = page
    .locator('[role="dialog"]')
    .getByRole('button', { name: /close|confirm/i })
    .last();
  await dialogConfirm.click();
  await pause(page, 2500);
});
