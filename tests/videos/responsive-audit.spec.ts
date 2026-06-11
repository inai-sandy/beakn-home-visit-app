import { mkdirSync, writeFileSync } from 'node:fs';

import { test, type Page } from '@playwright/test';

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
