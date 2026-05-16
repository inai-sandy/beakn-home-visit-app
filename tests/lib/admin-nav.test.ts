import { describe, expect, it } from 'vitest';

import {
  ADMIN_NAV,
  isAdminNavItemActive,
  resolveAdminPageTitle,
} from '@/lib/admin-nav';

// =============================================================================
// HVA-86: admin-nav pure helpers
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

  it('exact pathname match for /admin/captains lights "Captains"', () => {
    const captains = flatItems().find((i) => i.label === 'Captains')!;
    expect(isAdminNavItemActive(captains, '/admin/captains', null)).toBe(true);
  });

  it('nested pathname under /admin/captains still lights "Captains"', () => {
    const captains = flatItems().find((i) => i.label === 'Captains')!;
    expect(
      isAdminNavItemActive(
        captains,
        '/admin/captains/019e0000-0000-0000-0000-000000000001',
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
    // Wrong value or absent key → not active.
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
        '/admin/captains',
        new URLSearchParams('city=other'),
      ),
    ).toBe(false);
  });

  it('System (nested settings path) matches via exact, not nesting under /admin', () => {
    const system = flatItems().find((i) => i.label === 'System')!;
    expect(
      isAdminNavItemActive(
        system,
        '/admin/settings/system/customer-support-phone',
        null,
      ),
    ).toBe(true);
    expect(isAdminNavItemActive(system, '/admin/settings', null)).toBe(false);
  });
});

describe('resolveAdminPageTitle', () => {
  it('uses the matching nav item label as title', () => {
    expect(resolveAdminPageTitle('/admin/captains', null)).toBe('Captains');
    expect(resolveAdminPageTitle('/admin/executives', null)).toBe('Executives');
    expect(
      resolveAdminPageTitle('/admin/settings/organization/cities', null),
    ).toBe('Cities');
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
    expect(resolveAdminPageTitle('/admin/some-feature', null)).toBe('Some Feature');
  });
});
