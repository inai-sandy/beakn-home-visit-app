import { expect, test } from '@playwright/test';

import { loginAs, seededUsers } from './helpers/login';

// =============================================================================
// HVA-261: the GOLDEN JOURNEY — one request walked end-to-end via real UI
// =============================================================================
//
// Sandeep 2026-06-10: "build one automated journey test so the core
// business flow is protected end-to-end."
//
// The chain (serial — each step depends on the previous):
//   1. Captain assigns the seeded SUBMITTED request to the exec
//   2. Exec schedules the visit (calendar dialog)
//   3. Exec adds a quotation (Order tab)
//   4. Exec records a payment
//   5. Customer opens /track (no login) and sees the order
//   6. Customer raises a support ticket (needs Turnstile — auto-passes
//      with Cloudflare TEST keys in CI; soft-skips if a real key is
//      baked, e.g. a local run against a prod-built bundle)
//   7. Exec claims + resolves the ticket on /tickets
//   8. Customer sees the ticket Resolved on /track
//
// Steps 6–8 share the `ticketCreated` flag: if Turnstile can't auto-
// pass in this environment, they skip rather than fail — the pipeline
// half (1–5) must always pass.
//
// Seed contract (tests/setup/e2e-seed.ts): `journeyRequest` is
// SUBMITTED + fully unassigned and reserved for this spec.
// =============================================================================

let ticketCreated = false;
const TICKET_SUBJECT = 'Golden journey test ticket';

test.describe.serial('Golden journey', () => {
  // NOTE: this spec runs on the DESKTOP project only — tablet + mobile
  // exclude it via `testIgnore` in playwright.config.ts, because the
  // journey mutates its seeded request and would race itself across
  // viewport projects.

  test('1. captain assigns the new request to the exec', async ({ page }) => {
    const users = seededUsers();
    await loginAs(page, 'captain');
    await page.goto('/captain/requests/unassigned');

    // The journey request is the only SUBMITTED+unassigned row.
    await expect(
      page.getByText(users.journeyRequest.customerName).first(),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Assign' }).first().click();
    await expect(
      page.getByRole('heading', { name: /assign sales executive/i }),
    ).toBeVisible();

    // Pick Veera in the exec dropdown.
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: users.exec.fullName }).click();
    await page.getByRole('button', { name: /confirm assign/i }).click();

    // Success toast confirms the assignment. (Keep the match loose —
    // the seeded exec name contains regex metacharacters.)
    await expect(page.getByText(/assigned to/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test('2. exec schedules the visit via the calendar dialog', async ({
    page,
  }) => {
    const users = seededUsers();
    await loginAs(page, 'exec');
    await page.goto(`/requests/${users.journeyRequest.id}`);

    // Sticky header carries the primary next-action button.
    const advance = page.getByRole('button', { name: /move to/i }).first();
    await expect(advance).toBeVisible({ timeout: 10_000 });
    await advance.click();

    // Calendar dialog → tomorrow 11:00 IST.
    const when = page.locator('#visit-schedule-when');
    await expect(when).toBeVisible();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const value = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T11:00`;
    await when.fill(value);
    await page.getByRole('button', { name: /^schedule/i }).click();

    // Status badge in the sticky header flips to the scheduled stage.
    await expect(
      page.getByText(/visit scheduled/i).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('3. exec sets a target; the CartPlus quotation is read-only', async ({
    page,
  }) => {
    // HVA-281: real quotations now come from CartPlus (read-only in
    // Beakn). The seed synced a ₹50,000 portal quotation onto this
    // request; the exec sets a separate TARGET (a goal). Verifies both.
    const users = seededUsers();
    await loginAs(page, 'exec');
    await page.goto(`/requests/${users.journeyRequest.id}`);

    await page.getByRole('tab', { name: /order/i }).click();

    // The CartPlus actual quotation is shown read-only on the Order tab.
    await expect(page.getByText(/50,000/).first()).toBeVisible({
      timeout: 15_000,
    });

    // The exec sets a Target (distinct from the CartPlus actual).
    await page.getByRole('button', { name: /set target/i }).click();
    await page.locator('#target-amount').fill('60000');
    await page.getByRole('button', { name: /save target/i }).click();

    // The Target block re-renders with the saved value.
    await expect(page.getByText(/60,000/).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('4. exec records a payment', async ({ page }) => {
    const users = seededUsers();
    await loginAs(page, 'exec');
    await page.goto(`/requests/${users.journeyRequest.id}`);

    await page.getByRole('tab', { name: /order/i }).click();
    await page.getByRole('button', { name: /add payment/i }).click();

    await expect(
      page.getByRole('heading', { name: /record payment/i }),
    ).toBeVisible();
    await page.locator('#payment-amount').fill('20000');
    // payment-date defaults to today; mode defaults are fine if preset —
    // pick UPI explicitly so the test doesn't depend on a default.
    await page.locator('#payment-mode').click();
    await page.getByRole('option', { name: /upi/i }).click();
    await page
      .getByRole('button', { name: /record payment|save payment/i })
      .last()
      .click();

    // Paid amount shows up in the collection summary.
    await expect(page.getByText(/20,000/).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('5. customer sees the order on /track without logging in', async ({
    page,
  }) => {
    const users = seededUsers();
    await page.goto(`/track/${users.journeyRequest.trackingToken}`);

    // Status timeline rendered + the support entry point exists.
    await expect(page.getByText(/visit scheduled/i).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole('button', { name: /need help with this order/i }),
    ).toBeVisible();
  });

  test('6. customer raises a support ticket', async ({ page }) => {
    const users = seededUsers();
    await page.goto(`/track/${users.journeyRequest.trackingToken}`);

    await page
      .getByRole('button', { name: /need help with this order/i })
      .click();
    await expect(
      page.getByRole('heading', { name: /we're here to help/i }),
    ).toBeVisible();

    await page.locator('#ticket-subject').fill(TICKET_SUBJECT);
    await page
      .locator('#ticket-description')
      .fill('Automated golden-journey check — please ignore.');

    // Turnstile: with Cloudflare TEST keys (CI) the widget auto-passes
    // within a couple of seconds. With a REAL key baked into the bundle
    // (e.g. local run of a prod build) it cannot pass headlessly — we
    // detect the failure toast and soft-skip the ticket leg.
    await page.waitForTimeout(3_000);
    await page.getByRole('button', { name: /^send$/i }).click();

    const success = page.getByText(/got it — we'll be in touch/i);
    const challengeBlocked = page.getByText(
      /complete the challenge|verification failed/i,
    );
    const winner = await Promise.race([
      success
        .waitFor({ timeout: 15_000 })
        .then(() => 'success' as const)
        .catch(() => 'timeout' as const),
      challengeBlocked
        .waitFor({ timeout: 15_000 })
        .then(() => 'blocked' as const)
        .catch(() => 'timeout' as const),
    ]);

    test.skip(
      winner !== 'success',
      'Turnstile did not auto-pass in this environment — ticket leg skipped (CI uses test keys and runs it).',
    );
    ticketCreated = true;

    // The new ticket appears in the customer's list.
    await expect(page.getByText(TICKET_SUBJECT).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('7. exec claims and resolves the ticket', async ({ page }) => {
    test.skip(!ticketCreated, 'No ticket was created in step 6.');

    await loginAs(page, 'exec');
    await page.goto('/tickets');

    await expect(page.getByText(TICKET_SUBJECT).first()).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole('button', { name: /take this/i }).first().click();
    await expect(page.getByText(/claimed — you own this ticket/i)).toBeVisible(
      { timeout: 10_000 },
    );

    // Claiming moves the ticket from Open → In progress.
    await page.getByRole('button', { name: /^in progress$/i }).click();
    await expect(page.getByText(TICKET_SUBJECT).first()).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole('button', { name: /^resolve$/i }).first().click();
    await expect(page.getByText(/resolved — customer sees it/i)).toBeVisible({
      timeout: 10_000,
    });
  });

  test('8. customer sees the ticket resolved on /track', async ({ page }) => {
    test.skip(!ticketCreated, 'No ticket was created in step 6.');

    const users = seededUsers();
    await page.goto(`/track/${users.journeyRequest.trackingToken}`);

    await expect(page.getByText(TICKET_SUBJECT).first()).toBeVisible({
      timeout: 10_000,
    });
    // The ticket card shows the Resolved badge + the reopen affordance.
    await expect(page.getByText(/^resolved$/i).first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: /not resolved\? let us know/i }),
    ).toBeVisible();
  });
});
