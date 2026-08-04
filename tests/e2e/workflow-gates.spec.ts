import { expect, test } from '@playwright/test';

import { loginAs, seededUsers } from './helpers/login';

// =============================================================================
// The workflow gates, asserted in a real browser
// =============================================================================
//
// This spec exists because of the exact gap that produced the whole HVA-309…
// HVA-322 batch. Sandeep's report was: "we test we test we test but the result
// is unlimited bugs." The suite asserted that FUNCTIONS RETURN WHAT THE CODE
// INTENDS. Nothing asserted that A PERSON IN A ROLE SEES AND CAN USE THE RIGHT
// CONTROL ON SCREEN.
//
// So HVA-310 could make the UI faithfully obey `status_transitions` while every
// gate in that table was switched off, 1249 tests stayed green, and the
// pipeline was still clickable end to end. He found that in about a minute on
// his phone.
//
// These tests are the automation of that minute. They deliberately assert on
// what is RENDERED — a disabled button with its explanation, a dialog opening
// instead of a stage moving — not on what a route returns. The route-level
// refusals (QUOTATION_REQUIRED, DATETIME_REQUIRED, ROLE_NOT_ALLOWED) already
// have unit coverage; the thing that had none was the screen.
//
// Runs on the desktop project only, like the golden journey: these read a
// seeded request each and must not race sibling viewport projects.
// =============================================================================

test.describe('Workflow gates refuse on screen', () => {
  test('Quotation Given is disabled and says why (HVA-314)', async ({
    page,
  }) => {
    const users = seededUsers();
    await loginAs(page, 'exec');
    await page.goto(`/requests/${users.gateQuotationRequest.id}`);

    await expect(
      page.getByText(users.gateQuotationRequest.customerName).first(),
    ).toBeVisible({ timeout: 10_000 });

    // The control must still be PRESENT. Hiding it is what produced the
    // "it was there before, now it's gone" reports, so the fix was a
    // disabled button carrying the reason — not a vanishing one.
    const advance = page.getByRole('button', {
      name: /move to quotation given/i,
    });
    await expect(advance).toBeVisible();
    await expect(advance).toBeDisabled();

    // And the exec must be told why, on screen — not via a toast they have
    // to trigger, and not only in a title attribute they cannot hover on a
    // phone.
    await expect(
      page.getByText(/quotation must come from cartplus/i),
    ).toBeVisible();
  });

  test('advancing to Quotation Given does not move the stage', async ({
    page,
  }) => {
    // Belt and braces: a disabled button that still fires would look correct
    // in a screenshot and be wrong in the database.
    const users = seededUsers();
    await loginAs(page, 'exec');
    await page.goto(`/requests/${users.gateQuotationRequest.id}`);

    await page
      .getByRole('button', { name: /move to quotation given/i })
      .click({ force: true, timeout: 5_000 })
      .catch(() => {
        // A truly disabled button may refuse the click outright — that is
        // the desired outcome, not a failure.
      });

    await page.reload();
    // Still at Visit Completed.
    await expect(page.getByText(/visit completed/i).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('installation asks for a date instead of advancing (HVA-317)', async ({
    page,
  }) => {
    const users = seededUsers();
    await loginAs(page, 'exec');
    await page.goto(`/requests/${users.gateInstallRequest.id}`);

    await expect(
      page.getByText(users.gateInstallRequest.customerName).first(),
    ).toBeVisible({ timeout: 10_000 });

    await page
      .getByRole('button', { name: /move to installation scheduled/i })
      .click();

    // A dialog, not a stage change. Before HVA-317 this advanced in one tap
    // and scheduled nothing: no date stored, no Installation & Activation
    // task created, and the customer never told when to be home.
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole('dialog').getByText(/date|when|schedule/i).first(),
    ).toBeVisible();
  });

  test('the exec sees no rollback at Order Confirmed (HVA-313)', async ({
    page,
  }) => {
    // Order Confirmed is a one-way door for everyone but super_admin.
    // CartPlus locks the order at that point and the portal must match.
    const users = seededUsers();
    await loginAs(page, 'exec');
    await page.goto(`/requests/${users.gateInstallRequest.id}`);

    await expect(
      page.getByText(users.gateInstallRequest.customerName).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Open the tab that holds the secondary actions, if present.
    const adminTab = page.getByRole('tab', { name: /admin/i });
    if (await adminTab.count()) {
      await adminTab.first().click();
    }

    await expect(
      page.getByRole('button', { name: /go back to|roll ?back/i }),
    ).toHaveCount(0);
  });
});
