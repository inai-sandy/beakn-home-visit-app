import { ROLE_HOME, USER_ROLES, type Role } from '@/lib/auth/roles';

// =============================================================================
// HVA-235 (HVA-231 Phase 1.1): support layout authz decision — pure helper
// =============================================================================
//
// Mirror of lib/exec-authz.ts (HVA-115). The support layout at
// `app/(support)/layout.tsx` delegates the "should this session see
// /support/*?" question to this pure function so vitest can exercise
// the branches without a React render.
//
// proxy.ts (HVA-25) is the primary gate at the HTTP layer; this is
// defence-in-depth at the route group boundary.
//
// Decision shape:
//   * no session                       → /login?next=<encoded path>
//   * role === support                 → allow
//   * role is exec / captain / admin   → ROLE_HOME[role] (their own home)
//   * role is unknown / missing        → /login (defensive)
//
// Note: unlike the captain shell, super_admin does NOT escape-hatch in
// here. Mirrors HVA-115 (exec shell) — only the role-owner sees the
// portal. If admin support of /support becomes a need, file as
// follow-up.
// =============================================================================

export type SupportAccessDecision =
  | { allow: true }
  | { allow: false; redirectTo: string };

export interface SupportAccessSession {
  user: { role?: string };
}

export function decideSupportAccess(
  session: SupportAccessSession | null,
  nextPath: string,
): SupportAccessDecision {
  if (!session) {
    return { allow: false, redirectTo: `/login?next=${encodeURIComponent(nextPath)}` };
  }
  const role = session.user.role;
  if (role === USER_ROLES.SUPPORT) return { allow: true };
  if (role && role in ROLE_HOME) {
    return { allow: false, redirectTo: ROLE_HOME[role as Role] };
  }
  return { allow: false, redirectTo: '/login' };
}
