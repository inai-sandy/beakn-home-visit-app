import { mkdirSync } from 'node:fs';

import { test, expect, type Page } from '@playwright/test';
import postgres from 'postgres';

import { loginAs, seededUsers } from '../e2e/helpers/login';

// =============================================================================
// HVA-264: SCREENSHOT CAPTURE — every screen for the exec manual
// =============================================================================
//
// Camera-operator spec (like today-loop.record): drives the real app at
// phone width and snaps PNGs into test-results/manual-shots/. Publish
// with scripts/publish-videos.sh (which also ships images).
//
// Test blocks are NOT serial — one failed shot must not kill the rest.
// Order still matters for app STATE (the file runs top-to-bottom with
// workers=1): the day is started in block B and closed in the LAST
// block, because closing locks the task surface.
//
// Run: pnpm test:e2e --config=playwright.videos.config.ts manual-shots
// =============================================================================

// Screenshots only — no video for this spec (keeps publish-videos.sh
// from shipping accidental clips of the capture run).
test.use({ video: 'off' });

const SHOT_DIR = 'test-results/manual-shots';

function shotPath(name: string) {
  mkdirSync(SHOT_DIR, { recursive: true });
  return `${SHOT_DIR}/${name}.png`;
}

async function settle(page: Page, ms = 900) {
  await page.waitForTimeout(ms);
}

async function shoot(page: Page, name: string) {
  await settle(page);
  await page.screenshot({ path: shotPath(name) });
}

// ---------------------------------------------------------------------------
// A. Getting started
// ---------------------------------------------------------------------------

test('A1 login page', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('#phone')).toBeVisible();
  await shoot(page, '01-login');
});

test('A2 home with bottom bar + drawer', async ({ page }) => {
  await loginAs(page, 'exec');
  await page.goto('/today');
  await shoot(page, '02-home-bottom-bar');
  // Open the menu drawer (hamburger trigger in the topbar).
  await page.getByRole('button', { name: /menu|open menu|navigation/i }).first().click()
    .catch(async () => {
      await page.locator('header button').first().click();
    });
  await settle(page);
  await shoot(page, '03-menu-drawer');
});

// ---------------------------------------------------------------------------
// B. Daily loop — start day, tasks
// ---------------------------------------------------------------------------

test('B1 start my day + task flow', async ({ page }) => {
  await loginAs(page, 'exec');
  await page.goto('/today');
  await expect(page.getByRole('button', { name: /start my day/i })).toBeVisible({
    timeout: 15_000,
  });
  await shoot(page, '04-today-start-my-day');

  await page.getByRole('button', { name: /start my day/i }).click();
  await settle(page, 2000);

  // Add Task sheet
  const addTask = page.getByRole('button', { name: /add task/i }).first();
  await expect(addTask).toBeVisible({ timeout: 15_000 });
  await addTask.click();
  await settle(page);
  const sheet = page.locator('[role="dialog"]');
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button').first().click();
  await page
    .locator('#add-task-description')
    .fill('Call Mr. Sharma about curtain samples');
  await shoot(page, '05-add-task-sheet');
  await sheet.getByRole('button', { name: /^add task$/i }).click();
  await settle(page, 1500);
  await shoot(page, '06-today-task-list');

  // Mark as Done — outcome box
  await page.getByRole('button', { name: /mark as done/i }).first().click();
  await settle(page);
  await shoot(page, '07-mark-done-outcome');
  const confirm = page.getByRole('button', { name: /^confirm$/i });
  if (await confirm.isVisible().catch(() => false)) {
    await page.locator('textarea').last().fill('Customer confirmed — visiting Saturday');
    await confirm.click();
  }
  await settle(page, 1800);
  await shoot(page, '08-task-done-undo');

  // Second task → postpone sheet
  await page.getByRole('button', { name: /add task/i }).first().click();
  await settle(page);
  await sheet.getByRole('button').first().click();
  await page.locator('#add-task-description').fill('Drop fabric samples at Banjara Hills');
  await sheet.getByRole('button', { name: /^add task$/i }).click();
  await settle(page, 1500);
  await page.getByRole('button', { name: /postpone/i }).first().click();
  await settle(page);
  await shoot(page, '09-postpone-sheet');
  await page.keyboard.press('Escape');
});

test('B2 tasks page + calendar', async ({ page }) => {
  await loginAs(page, 'exec');
  await page.goto('/tasks');
  await shoot(page, '10-tasks-page');
  await page.goto('/calendar');
  await shoot(page, '11-calendar');
});

// ---------------------------------------------------------------------------
// C. Requests & money (uses the seeded ASSIGNED sample request)
// ---------------------------------------------------------------------------

test('C1 requests list + detail + schedule dialog', async ({ page }) => {
  const users = seededUsers();
  await loginAs(page, 'exec');
  await page.goto('/requests');
  await shoot(page, '12-requests-list');

  await page.goto(`/requests/${users.sampleRequest.id}`);
  await expect(page.getByRole('button', { name: /move to/i }).first()).toBeVisible({
    timeout: 15_000,
  });
  await shoot(page, '13-request-detail');

  // Open the schedule dialog (next step from ASSIGNED needs a datetime)
  await page.getByRole('button', { name: /move to/i }).first().click();
  await settle(page);
  if (await page.locator('#visit-schedule-when').isVisible().catch(() => false)) {
    await shoot(page, '14-schedule-visit-dialog');
    await page.keyboard.press('Escape');
  }
});

test('C2 order tab — quotation + payment dialogs', async ({ page }) => {
  const users = seededUsers();
  await loginAs(page, 'exec');
  await page.goto(`/requests/${users.sampleRequest.id}`);
  await page.getByRole('tab', { name: /order/i }).click();
  await settle(page);
  await shoot(page, '15-order-tab');

  await page.getByRole('button', { name: /add quotation/i }).click();
  await settle(page);
  await page.locator('#quotation-amount').fill('125000');
  await shoot(page, '16-add-quotation');
  await page.getByRole('button', { name: /save quotation/i }).click();
  await settle(page, 1500);

  await page.getByRole('button', { name: /add payment/i }).click();
  await settle(page);
  await page.locator('#payment-amount').fill('50000');
  await shoot(page, '17-add-payment');
  await page.keyboard.press('Escape');
});

// ---------------------------------------------------------------------------
// D. Customer side + tickets
// ---------------------------------------------------------------------------

test('D1 track page + need-help dialog', async ({ page }) => {
  const users = seededUsers();
  await page.goto(`/track/${users.sampleRequest.trackingToken}`);
  await shoot(page, '18-track-page');
  await page
    .getByRole('button', { name: /need help with this order/i })
    .click();
  await settle(page, 1500);
  await page.locator('#ticket-subject').fill('Wrong colour delivered');
  await page
    .locator('#ticket-description')
    .fill('We ordered grey but the blinds are blue.');
  await shoot(page, '19-need-help-dialog');
});

test('D2 tickets queue — take this, resolve', async ({ page }) => {
  // Seed a ticket directly (Turnstile-free) so the queue has a row.
  const users = seededUsers();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    await sql`
      INSERT INTO support_tickets (request_id, category, subject, description, status,
        customer_name_snapshot, customer_phone_snapshot)
      VALUES (${users.sampleRequest.id}, 'complaint', 'Wrong colour delivered',
        'We ordered grey but the blinds are blue.', 'open', 'E2E Customer', '+919876500001')
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }

  await loginAs(page, 'exec');
  await page.goto('/tickets');
  await expect(page.getByRole('button', { name: /take this/i }).first()).toBeVisible({
    timeout: 15_000,
  });
  await shoot(page, '20-tickets-take-this');

  await page.getByRole('button', { name: /take this/i }).first().click();
  await settle(page, 1800);
  await page.getByRole('button', { name: /^in progress$/i }).click();
  await expect(page.getByRole('button', { name: /^resolve$/i }).first()).toBeVisible({
    timeout: 15_000,
  });
  await shoot(page, '21-ticket-resolve');
  await page.getByRole('button', { name: /^resolve$/i }).first().click();
  await settle(page, 1500);

  // Customer view of the resolved ticket
  await page.goto(`/track/${users.sampleRequest.trackingToken}`);
  await shoot(page, '22-track-ticket-resolved');
});

// ---------------------------------------------------------------------------
// E. The other pages
// ---------------------------------------------------------------------------

test('E1 remaining exec pages', async ({ page }) => {
  await loginAs(page, 'exec');
  const pages: Array<[string, string]> = [
    ['/leads', '23-contacts'],
    ['/assist', '24-assist'],
    ['/dashboard', '25-dashboard'],
    ['/finance', '26-finance'],
    ['/leaderboard', '27-leaderboard'],
    ['/exec/reports', '28-reports'],
    ['/resources', '29-resources'],
    ['/announcements', '30-announcements'],
    ['/profile', '31-profile'],
  ];
  for (const [url, name] of pages) {
    await page.goto(url);
    await shoot(page, name);
  }
});

// ---------------------------------------------------------------------------
// F. Close day — LAST, because it locks the day
// ---------------------------------------------------------------------------

test('F1 close day page + confirm dialog', async ({ page }) => {
  await loginAs(page, 'exec');
  await page.goto('/today/close');
  await expect(page.getByRole('button', { name: /close the day/i })).toBeVisible({
    timeout: 15_000,
  });
  await shoot(page, '32-close-day-summary');
  await page.getByRole('button', { name: /close the day/i }).click();
  await settle(page);
  await shoot(page, '33-close-day-confirm');
});
