import { mkdirSync, writeFileSync } from 'node:fs';

import { test, type Page } from '@playwright/test';
import postgres from 'postgres';

import { flatAdminNavItems } from '../../lib/admin-nav';
import { CAPTAIN_NAV_ITEMS } from '../../lib/captain/nav';
import { EXEC_DRAWER_NAV } from '../../lib/exec-nav';
import { loginAs, seededUsers } from '../e2e/helpers/login';

// =============================================================================
// HVA-266: RESPONSIVE AUDIT — find every page with horizontal overflow
// =============================================================================
//
// Sandeep 2026-06-11: "most of the pages are not responsive. The content
// is flowing out … tiles filling completely and floating out and cutting."
//
// This spec does NOT fix anything. It measures. For every page in all
// three portals (enumerated from the app's own nav configs so nothing
// is skipped), at three widths (320 small phone / 390 phone / 768
// tablet):
//
//   1. detect horizontal overflow: scrollWidth > clientWidth
//   2. list the actual offending elements (rect.right beyond viewport)
//   3. screenshot ONLY broken pages → test-results/responsive-audit/
//   4. write a JSON report → test-results/responsive-audit/report.json
//
// Run: pnpm test:e2e --config=playwright.videos.config.ts responsive-audit
// =============================================================================

test.use({ video: 'off' });

const OUT_DIR = 'test-results/responsive-audit';
const WIDTHS = [320, 390, 768] as const;

interface Offender {
  tag: string;
  cls: string;
  width: number;
  overhang: number;
}

interface PageResult {
  portal: string;
  url: string;
  width: number;
  overflowPx: number;
  offenders: Offender[];
}

const results: PageResult[] = [];

// ---------------------------------------------------------------------------
// HVA-272: STRESS SEED — prod-shaped extremes the clean seed can't show.
// Long names/addresses, ₹99,99,99,999 amounts, max-length ticket
// subjects. Runs FIRST (file order, workers=1) so every later
// measurement sees the worst realistic content.
// ---------------------------------------------------------------------------

const LONG_NAME = 'Venkata Subrahmanyeswara Prasad Rao Chowdary Garu Jr.';
const LONG_ADDR =
  'Flat No. 1203-B, Sri Lakshmi Venkateswara Heights, Plot 45-47, Road No. 12, Banjara Hills Extension, Near Apollo Hospital Back Gate, Hyderabad 500034, Telangana';

test('S0 stress seed', async () => {
  const users = seededUsers();
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
  try {
    await sql`
      UPDATE visit_requests
      SET customer_name = ${LONG_NAME}, address = ${LONG_ADDR}
      WHERE id = ${users.sampleRequest.id}
    `;
    await sql`
      UPDATE users SET full_name = 'Veera Venkata Satyanarayana Murthy (Senior Sales Executive)'
      WHERE id = ${users.exec.id}
    `;
    // Huge money: ₹99,99,99,999 quotation + partial payment → wide
    // numbers on finance/dashboard/collection surfaces.
    await sql`
      INSERT INTO quotations (visit_request_id, total_order_value_paise, submitted_by_user_id)
      VALUES (${users.sampleRequest.id}, 999999999900, ${users.exec.id})
      ON CONFLICT (visit_request_id) DO UPDATE SET total_order_value_paise = 999999999900
    `;
    await sql`
      INSERT INTO payments (visit_request_id, direction, amount_paise, payment_date, mode, recorded_by_user_id)
      VALUES (${users.sampleRequest.id}, 'inbound', 123456789, CURRENT_DATE, 'Bank Transfer', ${users.exec.id})
    `;
    // Max-length ticket subject (200 chars) + long snapshots.
    await sql`
      INSERT INTO support_tickets (request_id, category, subject, description, status,
        customer_name_snapshot, customer_phone_snapshot)
      VALUES (${users.sampleRequest.id}, 'complaint', ${'The motorised curtain track in the master bedroom is making a continuous loud clicking and grinding noise every time it operates and the fabric is also getting stuck halfway through closing fully now'}, 'Long description for stress testing the queue row rendering with realistic verbose customer complaints.', 'open',
        ${LONG_NAME}, '+919876500001')
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
});


async function measure(page: Page, portal: string, url: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => {});
    await page.waitForTimeout(600);

    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const vw = doc.clientWidth;
      const overflowPx = Math.max(0, doc.scrollWidth - vw);
      const offenders: Array<{ tag: string; cls: string; width: number; overhang: number }> = [];
      if (overflowPx > 1) {
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          const r = el.getBoundingClientRect();
          // real offenders only: meaningfully wide + sticking out
          if (r.width > 40 && r.right > vw + 2 && offenders.length < 8) {
            const cls = (el.getAttribute('class') ?? '').slice(0, 110);
            // skip elements whose PARENT is already reported (avoid noise)
            const parentCls = (el.parentElement?.getAttribute('class') ?? '').slice(0, 110);
            if (offenders.some((o) => o.cls === parentCls)) continue;
            offenders.push({
              tag: el.tagName.toLowerCase(),
              cls,
              width: Math.round(r.width),
              overhang: Math.round(r.right - vw),
            });
          }
        }
      }
      return { overflowPx, offenders };
    });

    if (m.overflowPx > 1) {
      mkdirSync(OUT_DIR, { recursive: true });
      const slug = `${portal}-${url.replace(/[^a-z0-9]+/gi, '_')}-${width}`;
      await page.screenshot({ path: `${OUT_DIR}/${slug}.png` });
      results.push({ portal, url, width, overflowPx: m.overflowPx, offenders: m.offenders });
    }
  }
}

test('audit exec portal', async ({ page }) => {
  test.setTimeout(600_000);
  const users = seededUsers();
  await loginAs(page, 'exec');
  const urls = [
    ...EXEC_DRAWER_NAV.map((i) => i.href),
    '/today/close',
    `/requests/${users.sampleRequest.id}`,
  ];
  for (const url of urls) await measure(page, 'exec', url);
});

test('audit captain portal', async ({ page }) => {
  test.setTimeout(600_000);
  const users = seededUsers();
  await loginAs(page, 'captain');
  const urls = [
    ...CAPTAIN_NAV_ITEMS.map((i) => i.href),
    '/captain/requests/unassigned',
    `/captain/team/${users.exec.id}`,
    `/captain/team/${users.exec.id}/warnings`,
    `/requests/${users.sampleRequest.id}`,
  ];
  for (const url of urls) await measure(page, 'captain', url);
});

test('audit admin portal', async ({ page }) => {
  test.setTimeout(600_000);
  await loginAs(page, 'superAdmin');
  // href is optional on AdminNavItem (disabled stubs render without one).
  const urls = flatAdminNavItems()
    .map((i) => i.href)
    .filter((href): href is string => typeof href === 'string');
  for (const url of urls) await measure(page, 'admin', url);
});

test('audit public pages', async ({ page }) => {
  test.setTimeout(300_000);
  const users = seededUsers();
  for (const url of ['/login', '/request', `/track/${users.sampleRequest.trackingToken}`]) {
    await measure(page, 'public', url);
  }
});

test.afterAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(results, null, 2));
  // Console summary, worst first.
  const sorted = [...results].sort((a, b) => b.overflowPx - a.overflowPx);
  console.log(`\n=== RESPONSIVE AUDIT: ${results.length} broken page×width combos ===`);
  for (const r of sorted) {
    console.log(
      `${String(r.overflowPx).padStart(4)}px over | ${r.width}px | ${r.portal} ${r.url} | ${r.offenders[0]?.tag}.${r.offenders[0]?.cls.split(' ').slice(0, 4).join('.')}`,
    );
  }
});
