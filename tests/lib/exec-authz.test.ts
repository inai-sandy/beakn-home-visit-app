import { describe, expect, it } from 'vitest';

import { decideExecAccess } from '@/lib/exec-authz';

// =============================================================================
// HVA-115: exec layout authz decision — pure helper tests
// =============================================================================
//
// Mirror of tests/lib/admin-authz.test.ts shape. Six role/session branches
// — covers the same matrix HVA-86's admin authz tests cover, with the
// target role swapped to sales_executive.
// =============================================================================

describe('decideExecAccess', () => {
  it('anonymous (null session) → /login with next path', () => {
    expect(decideExecAccess(null, '/today')).toEqual({
      allow: false,
      redirectTo: '/login?next=%2Ftoday',
    });
  });

  it('sales_executive → allow', () => {
    expect(
      decideExecAccess({ user: { role: 'sales_executive' } }, '/today'),
    ).toEqual({ allow: true });
  });

  it('captain → /captain/dashboard', () => {
    expect(
      decideExecAccess({ user: { role: 'captain' } }, '/today'),
    ).toEqual({ allow: false, redirectTo: '/captain/dashboard' });
  });

  it('super_admin → /admin/dashboard (no reverse escape hatch)', () => {
    expect(
      decideExecAccess({ user: { role: 'super_admin' } }, '/today'),
    ).toEqual({ allow: false, redirectTo: '/admin/dashboard' });
  });

  it('unknown role → /login (defensive)', () => {
    expect(
      decideExecAccess({ user: { role: 'definitely_not_a_role' } }, '/today'),
    ).toEqual({ allow: false, redirectTo: '/login' });
  });

  it('session with no role → /login', () => {
    expect(decideExecAccess({ user: {} }, '/today')).toEqual({
      allow: false,
      redirectTo: '/login',
    });
  });

  it('next path with query string is encoded correctly', () => {
    expect(
      decideExecAccess(null, '/requests?status=open'),
    ).toEqual({
      allow: false,
      redirectTo: '/login?next=%2Frequests%3Fstatus%3Dopen',
    });
  });
});
