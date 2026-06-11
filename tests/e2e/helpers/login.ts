import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { expect, type BrowserContext, type Page } from '@playwright/test';

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

// HVA-269 (root cause of the recurring "mobile login timeout" flake):
// better-auth rate-limits /sign-in/phone-number to 20 per 15 minutes per
// IP. The suite was doing ~30 FORM logins per run (3 viewport projects ×
// every spec) — logins #21+ got HTTP 429, the form never navigated, and
// the tests bled out at waitForURL. The mobile project runs last, so it
// always took the hit.
//
// Fix: real form login happens ONCE per role per run; the session
// cookies are cached on disk and injected into every later context.
// Stale caches (fresh testcontainer per run) self-heal: an invalid
// session bounces to /login, which we detect and fall through to a
// fresh form login. scripts/run-e2e.ts wipes the cache dir at startup.
const AUTH_DIR = 'tests/e2e/.auth';

export async function loginAs(
  page: Page,
  who: 'exec' | 'captain' | 'superAdmin',
): Promise<void> {
  const stateFile = `${AUTH_DIR}/${who}.json`;

  // Fast path: inject the cached session and let the proxy route us.
  if (existsSync(stateFile)) {
    try {
      type Cookies = Awaited<ReturnType<BrowserContext['storageState']>>['cookies'];
      const { cookies } = JSON.parse(readFileSync(stateFile, 'utf-8')) as {
        cookies: Cookies;
      };
      await page.context().addCookies(cookies);
      // Land on the role's home (mirrors the post-login redirect the
      // form path produces). '/' is the PUBLIC customer page — useless
      // as a session probe.
      const home =
        who === 'captain'
          ? '/captain/dashboard'
          : who === 'superAdmin'
            ? '/admin/dashboard'
            : '/today';
      await page.goto(home);
      await page.waitForLoadState('domcontentloaded');
      if (!page.url().includes('/login')) return;
      // Stale session (new DB) — clear and fall through to the form.
      await page.context().clearCookies();
    } catch {
      // Unreadable cache — fall through to the form.
    }
  }

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
  // Wait for the navigation away from /login. HVA-266-FIX1: was 10s,
  // which flaked under load. (The REAL fix for the recurring timeout was
  // the 429 discovery above — this stays as render tolerance.)
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
    timeout: 30_000,
  });
  // Sanity: not still on a login error variant.
  await expect(page).not.toHaveURL(/\/login/);

  // Cache the session for every later test in this run.
  mkdirSync(AUTH_DIR, { recursive: true });
  const state = await page.context().storageState();
  writeFileSync(stateFile, JSON.stringify({ cookies: state.cookies }));
}
