import { describe, expect, it } from 'vitest';

import {
  ADMIN_NAV,
  flatAdminNavItems,
  isAdminNavItemActive,
  isAdminNavSubgroupActive,
  resolveAdminPageTitle,
  type AdminNavSubgroup,
} from '@/lib/admin-nav';

// =============================================================================
// HVA-86 + HVA-89: admin-nav pure helpers
// =============================================================================

function getSubgroup(label: string): AdminNavSubgroup {
  const settings = ADMIN_NAV.find((g) => g.label === 'Settings')!;
  const sg = (settings.subgroups ?? []).find((s) => s.label === label);
  if (!sg) throw new Error(`No subgroup '${label}'`);
  return sg;
}

describe('isAdminNavItemActive', () => {
  it('Reports group items each have a real href (no placeholders)', () => {
    const reports = ADMIN_NAV.find((g) => g.label === 'Reports')!;
    for (const item of reports.items ?? []) {
      expect(item.placeholder).toBeFalsy();
      expect(item.href).toBeDefined();
      expect(item.href).toMatch(/^\/admin\/reports/);
    }
  });

  it('exact pathname match lights "Captains"', () => {
    const captains = flatAdminNavItems().find((i) => i.label === 'Captains')!;
    expect(
      isAdminNavItemActive(
        captains,
        '/admin/settings/organization/captains',
        null,
      ),
    ).toBe(true);
  });

  it('nested pathname under captains route still lights "Captains"', () => {
    const captains = flatAdminNavItems().find((i) => i.label === 'Captains')!;
    expect(
      isAdminNavItemActive(
        captains,
        '/admin/settings/organization/captains/019e0000-0000-0000-0000-000000000001',
        null,
      ),
    ).toBe(true);
  });

  it('"All Requests" now points to /admin/operations/requests (no longer a placeholder)', () => {
    const all = flatAdminNavItems().find((i) => i.label === 'All Requests')!;
    expect(all.placeholder).toBeFalsy();
    expect(all.href).toBe('/admin/operations/requests');
    expect(
      isAdminNavItemActive(all, '/admin/operations/requests', null),
    ).toBe(true);
  });

  it('HVA-95: "Other-city Queue" lights at /admin/operations/other-city', () => {
    const other = flatAdminNavItems().find(
      (i) => i.label === 'Other-city Queue',
    )!;
    expect(
      isAdminNavItemActive(other, '/admin/operations/other-city', null),
    ).toBe(true);
    expect(isAdminNavItemActive(other, '/admin/requests', null)).toBe(false);
  });

  it('Customer Support Phone (under notifications) matches exactly', () => {
    const phone = flatAdminNavItems().find(
      (i) => i.label === 'Customer Support Phone',
    )!;
    expect(
      isAdminNavItemActive(
        phone,
        '/admin/settings/notifications/customer-support-phone',
        null,
      ),
    ).toBe(true);
    expect(
      isAdminNavItemActive(phone, '/admin/settings/notifications', null),
    ).toBe(false);
  });
});

describe('isAdminNavSubgroupActive (HVA-89)', () => {
  it('returns true when a leaf inside the subgroup matches the URL', () => {
    const org = getSubgroup('Organization');
    expect(
      isAdminNavSubgroupActive(
        org,
        '/admin/settings/organization/cities',
        null,
      ),
    ).toBe(true);
    expect(
      isAdminNavSubgroupActive(
        org,
        '/admin/settings/audit-content/resources',
        null,
      ),
    ).toBe(false);
  });

  it('returns false for comingSoon subgroups (never active)', () => {
    const ai = getSubgroup('AI & Report Cards');
    expect(ai.comingSoon).toBe(true);
    expect(isAdminNavSubgroupActive(ai, '/admin/anything', null)).toBe(false);
  });
});

describe('ADMIN_NAV structure (HVA-89 accordion)', () => {
  it('has Operations + Settings + Reports groups', () => {
    expect(ADMIN_NAV.map((g) => g.label)).toEqual([
      'Operations',
      'Settings',
      'Reports',
    ]);
  });

  it('Settings group uses subgroups (not flat items)', () => {
    const settings = ADMIN_NAV.find((g) => g.label === 'Settings')!;
    expect(settings.subgroups).toBeDefined();
    expect(settings.items).toBeUndefined();
  });

  it('Settings has the HVA-89 subgroups in order (+ HVA-248 Integrations)', () => {
    const settings = ADMIN_NAV.find((g) => g.label === 'Settings')!;
    expect((settings.subgroups ?? []).map((s) => s.label)).toEqual([
      'Organization',
      'Audit & Content',
      'Notifications',
      'Workflow & Status',
      'Targets',
      'Integrations',
      'AI & Report Cards',
    ]);
  });

  it('Targets is live with Monthly target; AI is still comingSoon; Workflow has Holidays', () => {
    // Targets promoted from comingSoon → live in the exec monthly
    // target ship 2026-06-02.
    const targets = getSubgroup('Targets');
    expect(targets.comingSoon).toBeUndefined();
    expect(targets.items.map((i) => i.label)).toEqual(['Monthly target']);

    // AI & Report Cards is still placeholder.
    const ai = getSubgroup('AI & Report Cards');
    expect(ai.comingSoon).toBe(true);
    expect(ai.items).toHaveLength(0);

    const workflow = getSubgroup('Workflow & Status');
    expect(workflow.comingSoon).toBeUndefined();
    expect(workflow.items.map((i) => i.label)).toEqual([
      'Status Stages',
      'Transitions',
      'Approval Timeout',
      'Refund Window',
      'Audit Retention',
      'Holidays',
    ]);
  });

  it('shipped subgroups have their HVA-89 leaves', () => {
    expect(getSubgroup('Organization').items.map((i) => i.label)).toEqual([
      'Cities',
      'Captains',
      'Executives',
      // HVA-236: support team admin onboarding
      'Support Team',
    ]);
    expect(
      getSubgroup('Audit & Content').items.map((i) => i.label),
    ).toEqual([
      'Resources',
      'Resource Categories',
      'Announcements',
      'Announcement Categories',
      // HVA-256-FIX1: admin-configurable customer ticket categories
      'Ticket Categories',
    ]);
    expect(getSubgroup('Notifications').items.map((i) => i.label)).toEqual([
      'Notification Rules',
      'Customer Support Phone',
    ]);
  });

  it('every shipped leaf sits under /admin/settings/*', () => {
    for (const label of [
      'Organization',
      'Audit & Content',
      'Notifications',
      'Workflow & Status',
    ] as const) {
      for (const item of getSubgroup(label).items) {
        expect(item.href).toMatch(/^\/admin\/settings\//);
      }
    }
  });
});

describe('flatAdminNavItems', () => {
  it('walks both flat items and subgroup items', () => {
    const labels = flatAdminNavItems().map((i) => i.label);
    // Operations flat items
    expect(labels).toContain('Dashboard');
    expect(labels).toContain('All Requests');
    // Settings subgroup items
    expect(labels).toContain('Captains');
    expect(labels).toContain('Resources');
    expect(labels).toContain('Customer Support Phone');
    // Reports library
    expect(labels).toContain('Reports library');
  });
});

describe('resolveAdminPageTitle', () => {
  it('uses the matching nav item label as title', () => {
    expect(
      resolveAdminPageTitle('/admin/settings/organization/captains', null),
    ).toBe('Captains');
    expect(
      resolveAdminPageTitle('/admin/settings/organization/executives', null),
    ).toBe('Executives');
    expect(
      resolveAdminPageTitle('/admin/settings/organization/cities', null),
    ).toBe('Cities');
    expect(
      resolveAdminPageTitle(
        '/admin/settings/audit-content/resources',
        null,
      ),
    ).toBe('Resources');
  });

  it('HVA-95: "Other-city Queue" title resolves at the new route', () => {
    expect(
      resolveAdminPageTitle('/admin/operations/other-city', null),
    ).toBe('Other-city Queue');
  });

  it('falls back to title-cased last segment for unmapped paths', () => {
    expect(resolveAdminPageTitle('/admin/widgets', null)).toBe('Widgets');
    expect(resolveAdminPageTitle('/admin/some-feature', null)).toBe(
      'Some Feature',
    );
  });
});
