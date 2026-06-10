import { mkdirSync } from 'node:fs';

import { test, expect, type Page } from '@playwright/test';
import postgres from 'postgres';

import { loginAs, seededUsers } from '../e2e/helpers/login';

// =============================================================================
// HVA-265: SCREENSHOT CAPTURE — every screen for the CAPTAIN manual
// =============================================================================
//
// Sibling of manual-shots.capture.spec.ts (the exec set). Captures the
// captain portal at phone width into test-results/captain-shots/.
// scripts/publish-videos.sh ships the PNGs to
// /var/www/docs/images/captain-manual/.
//
// State the captures need is seeded DIRECTLY in the DB (block S):
//   - a request parked at PENDING_CAPTAIN_APPROVAL (+ history row) so
//     the Approvals page has a real row
//   - a quotation + partial payment on the sample request so Finance
//     shows outstanding money
//   - an open support ticket so the Tickets queue has a row
//
// Run: pnpm test:e2e --config=playwright.videos.config.ts captain-shots
// =============================================================================

test.use({ video: 'off' });

const SHOT_DIR = 'test-results/captain-shots';

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
// S. Seed the states every later block depends on
// ---------------------------------------------------------------------------

test('S0 seed approval + finance + ticket states', async () => {
  const users = seededUsers();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    // Quotation + partial payment on the sample request → Finance rows.
    await sql`
      INSERT INTO quotations (visit_request_id, total_order_value_paise, submitted_by_user_id)
      VALUES (${users.sampleRequest.id}, 25000000, ${users.exec.id})
      ON CONFLICT DO NOTHING
    `;
    await sql`
      INSERT INTO payments (visit_request_id, direction, amount_paise, payment_date, mode, recorded_by_user_id)
      VALUES (${users.sampleRequest.id}, 'inbound', 10000000, CURRENT_DATE, 'UPI', ${users.exec.id})
    `;
    // Open ticket → Tickets queue row.
    await sql`
      INSERT INTO support_tickets (request_id, category, subject, description, status,
        customer_name_snapshot, customer_phone_snapshot)
      VALUES (${users.sampleRequest.id}, 'warranty', 'Motor making noise',
        'The curtain motor is making a clicking sound.', 'open', 'E2E Customer', '+919876500001')
    `;
    // A request parked at PENDING_CAPTAIN_APPROVAL (+ the history row the
    // approvals card/list reads) → Approvals page row.
    const [stage] = await sql<{ id: string; sequence_number: number }[]>`
      SELECT id, sequence_number FROM status_stages WHERE code = 'PENDING_CAPTAIN_APPROVAL' LIMIT 1
    `;
    const [submitted] = await sql<{ id: string }[]>`
      SELECT id FROM status_stages WHERE code = 'SUBMITTED' LIMIT 1
    `;
    const [city] = await sql<{ id: string }[]>`
      SELECT id FROM cities WHERE name = 'Hyderabad' LIMIT 1
    `;
    const [req] = await sql<{ id: string }[]>`
      INSERT INTO visit_requests (
        customer_name, customer_phone, address, city_id, bhk, interest,
        tracking_token, source, status_stage_id,
        assigned_exec_user_id, assigned_captain_user_id, assigned_at
      ) VALUES (
        'Approval Customer', '+919876500003', '7 Approval Street, Hyderabad',
        ${city.id}, '3BHK'::bhk_type, '["Complete Lighting"]'::jsonb,
        'e2eapproval123456789ab', 'web', ${stage.id},
        ${users.exec.id}, ${users.captain.id}, NOW()
      ) RETURNING id
    `;
    await sql`
      INSERT INTO request_status_history (
        request_id, from_status_stage_id, to_status_stage_id,
        sequence_number, transition_order, changed_by_user_id, changed_at
      ) VALUES (
        ${req.id}, ${submitted.id}, ${stage.id},
        ${stage.sequence_number}, 1, ${users.exec.id}, NOW()
      )
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

// ---------------------------------------------------------------------------
// A. Login + shell
// ---------------------------------------------------------------------------

test('A1 login + dashboard + drawer', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('#phone')).toBeVisible();
  await shoot(page, '01-login');

  await loginAs(page, 'captain');
  await page.goto('/captain/dashboard');
  await shoot(page, '02-dashboard');

  await page.getByRole('button', { name: /menu|open menu|navigation/i }).first().click()
    .catch(async () => {
      await page.locator('header button').first().click();
    });
  await settle(page);
  await shoot(page, '03-menu-drawer');
});

// ---------------------------------------------------------------------------
// B. Requests — list, unassigned queue, assign modal, request detail
// ---------------------------------------------------------------------------

test('B1 requests list + unassigned + assign modal', async ({ page }) => {
  await loginAs(page, 'captain');
  await page.goto('/captain/requests');
  await shoot(page, '04-requests-list');

  await page.goto('/captain/requests/unassigned');
  await shoot(page, '05-unassigned-queue');

  const assign = page.getByRole('button', { name: 'Assign' }).first();
  if (await assign.isVisible().catch(() => false)) {
    await assign.click();
    await settle(page);
    await shoot(page, '06-assign-modal');
    await page.keyboard.press('Escape');
  }
});

test('B2 request detail (captain view) + refund dialog', async ({ page }) => {
  const users = seededUsers();
  await loginAs(page, 'captain');
  await page.goto(`/requests/${users.sampleRequest.id}`);
  await settle(page, 1200);
  await shoot(page, '07-request-detail');

  // Order tab → the captain-only refund button.
  await page.getByRole('tab', { name: /order/i }).click();
  await settle(page);
  await shoot(page, '08-order-tab');
  const refund = page.getByRole('button', { name: /refund/i }).first();
  if (await refund.isVisible().catch(() => false)) {
    await refund.click();
    await settle(page);
    await shoot(page, '09-refund-dialog');
    await page.keyboard.press('Escape');
  }
});

// ---------------------------------------------------------------------------
// C. Approvals
// ---------------------------------------------------------------------------

test('C1 pending approvals', async ({ page }) => {
  await loginAs(page, 'captain');
  await page.goto('/captain/approvals');
  await expect(page.getByText(/approval customer/i).first()).toBeVisible({
    timeout: 15_000,
  });
  await shoot(page, '10-approvals');
});

// ---------------------------------------------------------------------------
// D. Team
// ---------------------------------------------------------------------------

test('D1 team + exec drill + targets', async ({ page }) => {
  const users = seededUsers();
  await loginAs(page, 'captain');
  await page.goto('/captain/team');
  await shoot(page, '11-team');

  await page.goto(`/captain/team/${users.exec.id}`);
  await settle(page, 1200);
  await shoot(page, '12-exec-drill');

  await page.goto('/captain/targets');
  await shoot(page, '13-targets');
});

// ---------------------------------------------------------------------------
// E. Tasks, calendar, contacts
// ---------------------------------------------------------------------------

test('E1 tasks + calendar + contacts', async ({ page }) => {
  await loginAs(page, 'captain');
  await page.goto('/captain/tasks');
  await shoot(page, '14-tasks');
  await page.goto('/captain/calendar');
  await shoot(page, '15-calendar');
  await page.goto('/captain/contacts');
  await shoot(page, '16-contacts');
});

// ---------------------------------------------------------------------------
// F. Tickets + assist
// ---------------------------------------------------------------------------

test('F1 tickets queue + assist', async ({ page }) => {
  await loginAs(page, 'captain');
  await page.goto('/captain/tickets');
  await expect(page.getByRole('button', { name: /take this/i }).first()).toBeVisible({
    timeout: 15_000,
  });
  await shoot(page, '17-tickets');
  await page.goto('/captain/assist');
  await shoot(page, '18-assist');
});

// ---------------------------------------------------------------------------
// G. Finance + leaderboard + reports
// ---------------------------------------------------------------------------

test('G1 finance + leaderboard + reports', async ({ page }) => {
  await loginAs(page, 'captain');
  await page.goto('/captain/collections');
  await settle(page, 1200);
  await shoot(page, '19-finance');
  await page.goto('/captain/leaderboard');
  await shoot(page, '20-leaderboard');
  await page.goto('/captain/reports');
  await shoot(page, '21-reports');
});

// ---------------------------------------------------------------------------
// H. Resources, announcements, profile
// ---------------------------------------------------------------------------

test('H1 resources + announcements + profile', async ({ page }) => {
  await loginAs(page, 'captain');
  await page.goto('/captain/resources');
  await shoot(page, '22-resources');
  await page.goto('/captain/announcements');
  await shoot(page, '23-announcements');
  await page.goto('/captain/profile');
  await shoot(page, '24-profile');
});
