import { ROLE_HOME, USER_ROLES, type Role } from '@/lib/auth/roles';

// =============================================================================
// HVA-115: exec layout authz decision — pure helper
// =============================================================================
//
// Mirror of lib/admin-authz.ts (HVA-86). The exec layout at
// `app/(exec)/layout.tsx` delegates the "should this session see /today
// + /requests + /profile?" question to this pure function so vitest under
// the HVA-101 harness can exercise the role branches without a React
// render.
//
// proxy.ts (HVA-25) is the primary gate at the HTTP layer; this is
// defence-in-depth at the route group boundary — the same pattern HVA-86
// + HVA-78 use.
//
// Decision shape:
//   * no session                       → /login?next=<encoded path>
//   * role === sales_executive         → allow
//   * role is captain or super_admin   → ROLE_HOME[role] (their own home)
//   * role is unknown / missing        → /login (defensive)
//
// Note on super_admin: the legacy /today page (pre-HVA-115) carried an
// HVA-99-style super_admin escape hatch so admins could view the exec
// list for support. HVA-115 brief says "Only `sales_executive` role passes
// the gate". We mirror HVA-86 (admin shell — no reverse escape hatch),
// so super_admin viewing /today now bounces to /admin/dashboard. If admin
// support of the exec UI becomes a real need, file as a follow-up.
// =============================================================================

export type ExecAccessDecision =
  | { allow: true }
  | { allow: false; redirectTo: string };

export interface ExecAccessSession {
  user: { role?: string };
}

export function decideExecAccess(
  session: ExecAccessSession | null,
  nextPath: string,
): ExecAccessDecision {
  if (!session) {
    return { allow: false, redirectTo: `/login?next=${encodeURIComponent(nextPath)}` };
  }
  const role = session.user.role;
  if (role === USER_ROLES.SALES_EXECUTIVE) return { allow: true };
  if (role && role in ROLE_HOME) {
    return { allow: false, redirectTo: ROLE_HOME[role as Role] };
  }
  return { allow: false, redirectTo: '/login' };
}
