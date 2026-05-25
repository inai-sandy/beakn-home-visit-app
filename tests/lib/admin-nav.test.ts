import { describe, expect, it } from 'vitest';

import {
  ADMIN_NAV,
  isAdminNavItemActive,
  resolveAdminPageTitle,
} from '@/lib/admin-nav';

// =============================================================================
// HVA-86 + HVA-89: admin-nav pure helpers
// =============================================================================

function flatItems() {
  return ADMIN_NAV.flatMap((g) => g.items);
}

describe('isAdminNavItemActive', () => {
  it('placeholder items are never active', () => {
    const reports = ADMIN_NAV.find((g) => g.label === 'Reports')!;
    for (const item of reports.items) {
      expect(item.placeholder).toBe(true);
      expect(isAdminNavItemActive(item, '/admin/anything', null)).toBe(false);
    }
  });

  it('exact pathname match lights "Captains"', () => {
    const captains = flatItems().find((i) => i.label === 'Captains')!;
    expect(
      isAdminNavItemActive(
        captains,
        '/admin/settings/organization/captains',
        null,
      ),
    ).toBe(true);
  });

  it('nested pathname under captains route still lights "Captains"', () => {
    const captains = flatItems().find((i) => i.label === 'Captains')!;
    expect(
      isAdminNavItemActive(
        captains,
        '/admin/settings/organization/captains/019e0000-0000-0000-0000-000000000001',
        null,
      ),
    ).toBe(true);
  });

  it('"All Requests" lights on bare /admin/requests, NOT on ?city=other', () => {
    const all = flatItems().find((i) => i.label === 'All Requests')!;
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
    const other = flatItems().find((i) => i.label === 'Other-city Queue')!;
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
    expect(
      isAdminNavItemActive(
        other,
        '/admin/settings/organization/captains',
        new URLSearchParams('city=other'),
      ),
    ).toBe(false);
  });

  it('Customer Support Phone (under notifications) matches exactly', () => {
    const phone = flatItems().find(
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

describe('ADMIN_NAV structure (HVA-89)', () => {
  it('has two operational groups + one Reports placeholder', () => {
    expect(ADMIN_NAV.map((g) => g.label)).toEqual([
      'Operations',
      'Settings',
      'Reports',
    ]);
  });

  it('Settings group flattens every config-y leaf under /admin/settings/*', () => {
    const settings = ADMIN_NAV.find((g) => g.label === 'Settings')!;
    for (const item of settings.items) {
      expect(item.href).toMatch(/^\/admin\/settings\//);
    }
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
