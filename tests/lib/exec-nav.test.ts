import { describe, expect, it } from 'vitest';

import {
  EXEC_NAV,
  isExecNavItemActive,
  resolveExecPageTitle,
} from '@/lib/exec-nav';

// =============================================================================
// HVA-115: exec-nav pure helper tests
// =============================================================================

describe('EXEC_NAV', () => {
  it('exposes the exec destinations in order', () => {
    expect(EXEC_NAV.map((i) => i.label)).toEqual([
      'Today',
      'Contacts',
      'Requests',
      'Profile',
    ]);
  });

  it('each item has href + label + icon', () => {
    for (const item of EXEC_NAV) {
      expect(typeof item.href).toBe('string');
      expect(item.href.startsWith('/')).toBe(true);
      expect(typeof item.label).toBe('string');
      expect(typeof item.icon).toBe('string');
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.icon.length).toBeGreaterThan(0);
    }
  });
});

describe('isExecNavItemActive', () => {
  it('exact-match /today lights Today', () => {
    const today = EXEC_NAV.find((i) => i.label === 'Today')!;
    expect(isExecNavItemActive(today, '/today')).toBe(true);
  });

  it('exact-match /requests lights Requests', () => {
    const requests = EXEC_NAV.find((i) => i.label === 'Requests')!;
    expect(isExecNavItemActive(requests, '/requests')).toBe(true);
  });

  it('exact-match /profile lights Profile', () => {
    const profile = EXEC_NAV.find((i) => i.label === 'Profile')!;
    expect(isExecNavItemActive(profile, '/profile')).toBe(true);
  });

  it('nested /requests/[id] is treated as nested under Requests', () => {
    // The detail page lives outside the (exec) group so the shell does not
    // wrap it — but if it ever moved inside the group the active-state
    // rule should still hold. Test the helper's behavior directly.
    const requests = EXEC_NAV.find((i) => i.label === 'Requests')!;
    expect(
      isExecNavItemActive(
        requests,
        '/requests/019e0000-0000-0000-0000-000000000001',
      ),
    ).toBe(true);
  });

  it('unrelated path does not light any tab', () => {
    for (const item of EXEC_NAV) {
      expect(isExecNavItemActive(item, '/login')).toBe(false);
      expect(isExecNavItemActive(item, '/admin/dashboard')).toBe(false);
    }
  });
});

describe('resolveExecPageTitle', () => {
  it('returns the matched item label for each main route', () => {
    expect(resolveExecPageTitle('/today')).toBe('Today');
    expect(resolveExecPageTitle('/leads')).toBe('Contacts');
    expect(resolveExecPageTitle('/requests')).toBe('Requests');
    expect(resolveExecPageTitle('/profile')).toBe('Profile');
  });

  it('falls back to title-cased last segment for unmapped paths', () => {
    expect(resolveExecPageTitle('/some-page')).toBe('Some Page');
    expect(resolveExecPageTitle('/')).toBe('Today'); // empty segments → fallback default
  });
});
