import { expect, test } from '@playwright/test';

import { loginAs } from './helpers/login';

// =============================================================================
// HVA-342: the exec asks for material off a real order, in a real browser
// =============================================================================
//
// The Assist section this replaces was not broken in a way any unit test
// could see: it saved what you typed, and it showed you what it saved. What
// it could not do was agree with the order. So the thing worth asserting on
// screen is that the exec is OFFERED real products from a real order and is
// not given anywhere to type one — plus that the quantity box cannot be
// driven past what the order still owes.
//
// Desktop project only, like the other seeded-request specs: these read the
// shared `Gate Install Customer` fixture and must not race sibling viewport
// projects.
// =============================================================================

test.describe('Exec requests a dispatch', () => {
  test('the pick list offers real products from the order', async ({
    page,
  }) => {
    await loginAs(page, 'exec');
    await page.goto('/dispatch/new');

    // Seeded on the confirmed order in tests/setup/e2e-seed.ts.
    await expect(page.getByText('Gate Install Customer')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText('Smart Door Lock')).toBeVisible();
    await expect(page.getByText('Motion Sensor')).toBeVisible();

    // The whole point of the ticket: there is no product name to type.
    await expect(
      page.getByPlaceholder(/product/i),
    ).toHaveCount(0);
  });

  test('the quantity box will not go past what the order still owes', async ({
    page,
  }) => {
    await loginAs(page, 'exec');
    await page.goto('/dispatch/new');

    const lock = page.getByText('Smart Door Lock');
    await expect(lock).toBeVisible({ timeout: 10_000 });

    // Tick it — the checkbox is labelled by the product name.
    await page.getByLabel('Smart Door Lock').check();

    const qty = page.getByLabel(/quantity of smart door lock/i);
    await expect(qty).toBeVisible();

    // 2 were ordered. Typing 9 must land on 2, not raise an error the exec
    // has to read and undo.
    await qty.fill('9');
    await expect(qty).toHaveValue('2');
  });

  test('submitting sends it to support and shows it as waiting', async ({
    page,
  }) => {
    await loginAs(page, 'exec');
    await page.goto('/dispatch/new');

    await expect(page.getByText('Motion Sensor')).toBeVisible({
      timeout: 10_000,
    });
    await page.getByLabel('Motion Sensor').check();

    await page.getByRole('button', { name: /send to support/i }).click();

    // Lands on the request detail, which reads per ORDER — that grouping is
    // what lets support ship one customer while another waits.
    await expect(page.getByText('Gate Install Customer')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/waiting on support/i)).toBeVisible();
    await expect(page.getByText('Motion Sensor')).toBeVisible();
  });
});
