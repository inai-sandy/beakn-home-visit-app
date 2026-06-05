import { readFileSync } from 'node:fs';

import { expect, type Page } from '@playwright/test';

import type { SeededE2EUsers } from '../../setup/e2e-seed';

// =============================================================================
// HVA-198: Playwright auth helper
// =============================================================================
//
// Loads the seeded e2e users (written to tests/e2e/.e2e-users.json by
// scripts/run-e2e.ts) and exposes a `loginAs` that drives the actual
// /login form. Better-Auth session cookies persist on the browser
// context, so subsequent navigations from this `page` are authed.
//
// The login form anchors (HVA-25/HVA-26):
//   - phone input: name="phone"
//   - password input: name="password"
//   - submit button: role=button, name=/sign in|continue/i
//
// On success the form redirects to ROLE_HOME (per lib/auth/roles.ts):
//   - sales_executive → /today
//   - captain         → /captain/dashboard
//   - super_admin     → /admin/dashboard
// We wait on `**` (any URL) to settle then assert we're not still on
// /login — keeps the helper resilient if any role's home changes.
// =============================================================================

function loadSeededUsers(): SeededE2EUsers {
  const filePath = process.env.E2E_USERS_FILE;
  if (!filePath) {
    throw new Error(
      'E2E_USERS_FILE not set. Run via `pnpm test:e2e` (which uses the runner).',
    );
  }
  return JSON.parse(readFileSync(filePath, 'utf-8')) as SeededE2EUsers;
}

export function seededUsers(): SeededE2EUsers {
  return loadSeededUsers();
}

export async function loginAs(
  page: Page,
  who: 'exec' | 'captain' | 'superAdmin',
): Promise<void> {
  const users = loadSeededUsers();
  const u = users[who];
  // The form's phone input strips non-digits and caps at 10 chars; the
  // submit handler prepends +91 before posting. Seed phones are stored
  // in E.164 (+91XXXXXXXXXX), so fill only the trailing 10 digits.
  const tenDigits = u.phone.replace(/\D/g, '').slice(-10);
  await page.goto('/login');
  await page.locator('#phone').fill(tenDigits);
  await page.locator('#password').fill(u.password);
  await page
    .getByRole('button', { name: /sign in|log in|continue/i })
    .first()
    .click();
  // Wait for the navigation away from /login. Up to 10s to account for
  // cold-cache first-render of the role home.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
    timeout: 10_000,
  });
  // Sanity: not still on a login error variant.
  await expect(page).not.toHaveURL(/\/login/);
}
