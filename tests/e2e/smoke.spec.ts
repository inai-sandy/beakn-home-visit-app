import { expect, test } from '@playwright/test';

// HVA-151: Foundation smoke tests.
//
// Read-only assertions on public surfaces. No mutations. No login (auth flows
// land in the follow-up scope tickets — exec daily loop, captain workflow,
// exec requests). These three exist so the suite has something to fail when
// a future PR breaks the login page, public request form, or 404 chrome.

test.describe('Public surfaces render', () => {
  test('/login form is present', async ({ page }) => {
    await page.goto('/login');
    // Phone + password inputs exist. Names are stable across the HVA-25 +
    // HVA-26 build (Better-Auth phone sign-in).
    await expect(
      page.getByLabel(/phone|mobile/i).first(),
    ).toBeVisible();
    await expect(page.getByLabel(/password/i).first()).toBeVisible();
    // A submit-shaped control. The form swaps copy between sign-in /
    // forgot-password states; match anything resembling a primary action.
    await expect(
      page
        .getByRole('button', { name: /sign in|log in|continue/i })
        .first(),
    ).toBeVisible();
  });

  test('/request public customer form renders', async ({ page }) => {
    await page.goto('/request');
    // Customer's home-visit submission form (HVA-34 / HVA-35). Name field
    // is the first required input and a stable anchor.
    await expect(
      page.getByLabel(/full name|name/i).first(),
    ).toBeVisible();
  });

  test('unauthenticated unknown route lands on /login (proxy.ts gate)', async ({
    page,
  }) => {
    // proxy.ts redirects any non-public unauthenticated request to
    // /login?next=<original>. So unknown routes do NOT 404 — they bounce.
    // Pinning the actual behavior so a future proxy.ts refactor that breaks
    // this gate fails loudly in CI.
    await page.goto('/this-route-definitely-does-not-exist');
    await expect(page).toHaveURL(/\/login(\?.*)?$/);
  });
});
