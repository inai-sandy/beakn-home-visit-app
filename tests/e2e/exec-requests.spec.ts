import { expect, test } from '@playwright/test';

import { loginAs, seededUsers } from './helpers/login';

// =============================================================================
// HVA-198 PR-B: exec /requests authenticated flow
// =============================================================================
//
// Third authed spec. Mirrors captain-workflow.spec.ts but on the
// exec side:
//   - /requests        (exec's bucketed requests list)
//   - /requests/[id]   (shared detail page)
//
// Uses the same seeded request as the captain spec (Veera is the
// assigned_exec_user_id, so it appears in her list).
// =============================================================================

test.describe('Exec requests', () => {
  test('login → /requests list shows the seeded request', async ({ page }) => {
    await loginAs(page, 'exec');
    await page.goto('/requests');
    await expect(page).toHaveURL(/\/requests/);
    const users = seededUsers();
    await expect(
      page.getByRole('link', { name: users.sampleRequest.customerName }).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveScreenshot('exec-requests-list.png', {
      fullPage: true,
    });
  });

  test('exec clicks the request → /requests/[id] loads', async ({ page }) => {
    const users = seededUsers();
    await loginAs(page, 'exec');
    await page.goto(`/requests/${users.sampleRequest.id}`);
    await expect(page).toHaveURL(
      new RegExp(`/requests/${users.sampleRequest.id}`),
    );
    await expect(page.getByText(/Test Lane|E2E Customer/i).first()).toBeVisible(
      { timeout: 10_000 },
    );
    await expect(page).toHaveScreenshot('exec-request-detail.png', {
      fullPage: true,
    });
  });
});
