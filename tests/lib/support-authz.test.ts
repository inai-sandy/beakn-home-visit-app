import { describe, expect, it } from 'vitest';

import { decideSupportAccess } from '@/lib/support-authz';

// =============================================================================
// HVA-235 (HVA-231 Phase 1.1): support layout authz decision tests
// =============================================================================
//
// Mirror of tests/lib/exec-authz.test.ts shape. Seven role/session
// branches — anonymous, the role-owner (support), each of the OTHER
// roles (bounce to their home), unknown role, no role, next-path
// encoding.
// =============================================================================

describe('decideSupportAccess', () => {
  it('anonymous (null session) → /login with next path', () => {
    expect(decideSupportAccess(null, '/support')).toEqual({
      allow: false,
      redirectTo: '/login?next=%2Fsupport',
    });
  });

  it('support → allow', () => {
    expect(
      decideSupportAccess({ user: { role: 'support' } }, '/support'),
    ).toEqual({ allow: true });
  });

  it('sales_executive → /today', () => {
    expect(
      decideSupportAccess({ user: { role: 'sales_executive' } }, '/support'),
    ).toEqual({ allow: false, redirectTo: '/today' });
  });

  it('captain → /captain/dashboard', () => {
    expect(
      decideSupportAccess({ user: { role: 'captain' } }, '/support'),
    ).toEqual({ allow: false, redirectTo: '/captain/dashboard' });
  });

  it('super_admin → /admin/dashboard (no reverse escape hatch)', () => {
    expect(
      decideSupportAccess({ user: { role: 'super_admin' } }, '/support'),
    ).toEqual({ allow: false, redirectTo: '/admin/dashboard' });
  });

  it('unknown role → /login (defensive)', () => {
    expect(
      decideSupportAccess(
        { user: { role: 'definitely_not_a_role' } },
        '/support',
      ),
    ).toEqual({ allow: false, redirectTo: '/login' });
  });

  it('session with no role → /login', () => {
    expect(decideSupportAccess({ user: {} }, '/support')).toEqual({
      allow: false,
      redirectTo: '/login',
    });
  });

  it('next path with query string is encoded correctly', () => {
    expect(
      decideSupportAccess(null, '/support/orders?status=ready'),
    ).toEqual({
      allow: false,
      redirectTo: '/login?next=%2Fsupport%2Forders%3Fstatus%3Dready',
    });
  });
});
