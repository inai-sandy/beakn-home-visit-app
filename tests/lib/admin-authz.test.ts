import { describe, expect, it } from 'vitest';

import { decideAdminAccess } from '@/lib/admin-authz';

// =============================================================================
// HVA-86: admin layout authz decision — pure helper tests
// =============================================================================
//
// The full layout integration (React render + redirect() throw) lives in
// app/admin/layout.tsx. The decision function it delegates to lives in
// lib/admin-authz.ts; these tests assert the three role branches +
// anonymous + unknown-role. Same shape proxy.ts enforces upstream.
// =============================================================================

describe('decideAdminAccess', () => {
  it('anonymous (null session) → /login with next path', () => {
    const decision = decideAdminAccess(null, '/admin/captains');
    expect(decision).toEqual({
      allow: false,
      redirectTo: '/login?next=%2Fadmin%2Fcaptains',
    });
  });

  it('super_admin → allow', () => {
    const decision = decideAdminAccess(
      { user: { role: 'super_admin' } },
      '/admin/captains',
    );
    expect(decision).toEqual({ allow: true });
  });

  it('captain → /captain/dashboard', () => {
    const decision = decideAdminAccess(
      { user: { role: 'captain' } },
      '/admin/captains',
    );
    expect(decision).toEqual({
      allow: false,
      redirectTo: '/captain/dashboard',
    });
  });

  it('sales_executive → /today', () => {
    const decision = decideAdminAccess(
      { user: { role: 'sales_executive' } },
      '/admin/captains',
    );
    expect(decision).toEqual({ allow: false, redirectTo: '/today' });
  });

  it('unknown role → /login (defensive)', () => {
    const decision = decideAdminAccess(
      { user: { role: 'definitely_not_a_role' } },
      '/admin/captains',
    );
    expect(decision).toEqual({ allow: false, redirectTo: '/login' });
  });

  it('session with no role → /login', () => {
    const decision = decideAdminAccess({ user: {} }, '/admin/captains');
    expect(decision).toEqual({ allow: false, redirectTo: '/login' });
  });
});
