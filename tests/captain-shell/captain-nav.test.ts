import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CAPTAIN_NAV_ITEMS,
  isCaptainNavItemActive,
  resolveCaptainPageTitle,
} from '@/lib/captain/nav';

// =============================================================================
// HVA-152: Captain nav config — regression guard for the shared source
// =============================================================================
//
// Goal: lock the data and the source-import path that both the desktop
// sidebar AND the mobile drawer read from. A render-level snapshot
// would be ideal but the vitest+esbuild+react-dom production runtime
// triple has a `jsxDEV is not a function` mismatch that's a separate
// infrastructure project. This data-level test catches the regressions
// the bundle's snapshot test was meant to catch:
//
//   - "did someone accidentally rename a nav item only in one surface"
//     → CAPTAIN_NAV_ITEMS shape pinned by inline snapshot below.
//
//   - "did the desktop sidebar stop importing from the shared lib"
//     → string-grep on app/(captain)/sidebar.tsx for the import line.
//     If the desktop sidebar inlines its own const, this test fails.
//
//   - "did the mobile drawer stop importing from the shared lib"
//     → same grep on the mobile sheet file.
//
// Combined with the lib helpers' unit tests below and Sandeep's
// desktop walk after deploy, this is sufficient regression coverage
// for the HVA-152 "desktop byte-identical" constraint.
// =============================================================================

describe('HVA-152: shared captain nav config', () => {
  it('CAPTAIN_NAV_ITEMS lists the expected items in the expected order', () => {
    expect(CAPTAIN_NAV_ITEMS).toMatchInlineSnapshot(`
      [
        {
          "href": "/captain/dashboard",
          "icon": "dashboard",
          "label": "Dashboard",
        },
        {
          "href": "/captain/requests",
          "icon": "list_alt",
          "label": "Requests",
        },
        {
          "href": "/captain/team",
          "icon": "groups",
          "label": "My Team",
        },
        {
          "href": "/captain/tasks",
          "icon": "task",
          "label": "Tasks",
        },
        {
          "href": "/captain/calendar",
          "icon": "calendar_month",
          "label": "Team Calendar",
        },
        {
          "href": "/captain/contacts",
          "icon": "contacts",
          "label": "Contacts",
        },
        {
          "href": "/captain/approvals",
          "icon": "task_alt",
          "label": "Pending Approvals",
        },
        {
          "href": "/tickets",
          "icon": "help_center",
          "label": "Tickets",
        },
        {
          "href": "/captain/assist",
          "icon": "support_agent",
          "label": "Assist Requests",
        },
        {
          "href": "/captain/collections",
          "icon": "payments",
          "label": "Finance",
        },
        {
          "href": "/captain/leaderboard",
          "icon": "leaderboard",
          "label": "Leaderboard",
        },
        {
          "href": "/captain/targets",
          "icon": "flag",
          "label": "Team Targets",
        },
        {
          "href": "/captain/reports",
          "icon": "monitoring",
          "label": "Reports",
        },
        {
          "href": "/captain/resources",
          "icon": "folder",
          "label": "Resources",
        },
        {
          "href": "/captain/announcements",
          "icon": "campaign",
          "label": "Announcements",
        },
        {
          "href": "/captain/profile",
          "icon": "person",
          "label": "Profile",
        },
      ]
    `);
  });

  it('desktop sidebar imports the shared nav (proves no inline-duplication regression)', () => {
    const path = join(
      process.cwd(),
      'app',
      '(captain)',
      'sidebar.tsx',
    );
    const src = readFileSync(path, 'utf8');
    expect(src).toContain('CAPTAIN_NAV_ITEMS');
    expect(src).toContain('@/lib/captain/nav');
    // No re-declaration of the array literal in sidebar.tsx.
    expect(src).not.toMatch(
      /const\s+NAV_ITEMS\s*:\s*NavItem\[\]\s*=\s*\[/,
    );
  });

  it('mobile drawer imports the shared nav (proves both surfaces share one source)', () => {
    const path = join(
      process.cwd(),
      'app',
      '(captain)',
      '_components',
      'CaptainSidebarSheet.tsx',
    );
    const src = readFileSync(path, 'utf8');
    expect(src).toContain('CAPTAIN_NAV_ITEMS');
    expect(src).toContain('@/lib/captain/nav');
  });
});

describe('HVA-152: isCaptainNavItemActive', () => {
  it('exact match for /captain/dashboard only (no descendant match)', () => {
    expect(isCaptainNavItemActive('/captain/dashboard', '/captain/dashboard')).toBe(
      true,
    );
    expect(
      isCaptainNavItemActive('/captain/dashboard', '/captain/dashboard/extra'),
    ).toBe(false);
  });

  it('descendant routes match for non-dashboard items', () => {
    expect(
      isCaptainNavItemActive('/captain/requests', '/captain/requests'),
    ).toBe(true);
    expect(
      isCaptainNavItemActive('/captain/requests', '/captain/requests/unassigned'),
    ).toBe(true);
    expect(
      isCaptainNavItemActive('/captain/requests', '/captain/approvals'),
    ).toBe(false);
  });

  it('unrelated pathnames do not match', () => {
    expect(isCaptainNavItemActive('/captain/team', '/captain/profile')).toBe(false);
    expect(isCaptainNavItemActive('/captain/team', '/')).toBe(false);
  });
});

describe('HVA-152: resolveCaptainPageTitle', () => {
  it('returns the nav label for the matching item', () => {
    expect(resolveCaptainPageTitle('/captain/dashboard')).toBe('Dashboard');
    expect(resolveCaptainPageTitle('/captain/requests')).toBe('Requests');
    expect(resolveCaptainPageTitle('/captain/approvals')).toBe('Pending Approvals');
    expect(resolveCaptainPageTitle('/captain/collections')).toBe('Finance');
  });

  it('descendant pathnames resolve to the parent label', () => {
    expect(resolveCaptainPageTitle('/captain/requests/unassigned')).toBe(
      'Requests',
    );
  });

  it('unknown pathnames fall back to "Captain"', () => {
    expect(resolveCaptainPageTitle('/captain/something-new')).toBe('Captain');
    expect(resolveCaptainPageTitle('/')).toBe('Captain');
  });
});
