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
  it('placeholder items (Reports group) are never active', () => {
    const reports = ADMIN_NAV.find((g) => g.label === 'Reports')!;
    for (const item of reports.items ?? []) {
      expect(item.placeholder).toBe(true);
      expect(isAdminNavItemActive(item, '/admin/anything', null)).toBe(false);
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

  it('"All Requests" lights on bare /admin/requests, NOT on ?city=other', () => {
    const all = flatAdminNavItems().find((i) => i.label === 'All Requests')!;
    expect(isAdminNavItemActive(all, '/admin/requests', null)).toBe(true);
    expect(
      isAdminNavItemActive(
        all,
        '/admin/requests',
        new URLSearchParams('city=other'),
      ),
    ).toBe(false);
  });

  it('"Other-city Queue" lights only when ?city=other is on /admin/requests', () => {
    const other = flatAdminNavItems().find(
      (i) => i.label === 'Other-city Queue',
    )!;
    expect(isAdminNavItemActive(other, '/admin/requests', null)).toBe(false);
    expect(
      isAdminNavItemActive(
        other,
        '/admin/requests',
        new URLSearchParams('city=other'),
      ),
    ).toBe(true);
    expect(
      isAdminNavItemActive(
        other,
        '/admin/requests',
        new URLSearchParams('city=blr'),
      ),
    ).toBe(false);
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
    const workflow = getSubgroup('Workflow & Status');
    expect(workflow.comingSoon).toBe(true);
    expect(isAdminNavSubgroupActive(workflow, '/admin/anything', null)).toBe(
      false,
    );
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

  it('Settings has the 6 HVA-89 subgroups in order', () => {
    const settings = ADMIN_NAV.find((g) => g.label === 'Settings')!;
    expect((settings.subgroups ?? []).map((s) => s.label)).toEqual([
      'Organization',
      'Audit & Content',
      'Notifications',
      'Workflow & Status',
      'Targets',
      'AI & Report Cards',
    ]);
  });

  it('Workflow / Targets / AI subgroups are comingSoon (empty items)', () => {
    for (const label of [
      'Workflow & Status',
      'Targets',
      'AI & Report Cards',
    ] as const) {
      const sg = getSubgroup(label);
      expect(sg.comingSoon).toBe(true);
      expect(sg.items).toHaveLength(0);
    }
  });

  it('shipped subgroups have their HVA-89 leaves', () => {
    expect(getSubgroup('Organization').items.map((i) => i.label)).toEqual([
      'Cities',
      'Captains',
      'Executives',
    ]);
    expect(
      getSubgroup('Audit & Content').items.map((i) => i.label),
    ).toEqual([
      'Resources',
      'Resource Categories',
      'Announcements',
      'Announcement Categories',
    ]);
    expect(getSubgroup('Notifications').items.map((i) => i.label)).toEqual([
      'Customer Support Phone',
    ]);
  });

  it('every shipped leaf sits under /admin/settings/*', () => {
    for (const label of [
      'Organization',
      'Audit & Content',
      'Notifications',
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
    // Reports placeholders
    expect(labels).toContain('Daily');
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

  it('"Other-city Queue" wins the title with ?city=other', () => {
    expect(
      resolveAdminPageTitle(
        '/admin/requests',
        new URLSearchParams('city=other'),
      ),
    ).toBe('Other-city Queue');
  });

  it('falls back to title-cased last segment for unmapped paths', () => {
    expect(resolveAdminPageTitle('/admin/widgets', null)).toBe('Widgets');
    expect(resolveAdminPageTitle('/admin/some-feature', null)).toBe(
      'Some Feature',
    );
  });
});
