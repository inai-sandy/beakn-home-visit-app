import { ROLE_HOME, type Role } from '@/lib/auth/roles';

// =============================================================================
// HVA-86: admin layout authz decision — pure helper
// =============================================================================
//
// The admin layout at app/admin/layout.tsx delegates the "should this
// session see /admin/*?" question to this pure function so vitest under
// the HVA-101 harness can exercise the three role cases without a React
// render. Same logic that proxy.ts applies upstream — defence in depth.
// =============================================================================

export type AdminAccessDecision =
  | { allow: true }
  | { allow: false; redirectTo: string };

export interface AdminAccessSession {
  user: { role?: string };
}

export function decideAdminAccess(
  session: AdminAccessSession | null,
  nextPath: string,
): AdminAccessDecision {
  if (!session) {
    // URL-encode nextPath so query strings + slashes survive the redirect.
    return { allow: false, redirectTo: `/login?next=${encodeURIComponent(nextPath)}` };
  }
  const role = session.user.role;
  if (role === 'super_admin') return { allow: true };
  if (role && role in ROLE_HOME) {
    return { allow: false, redirectTo: ROLE_HOME[role as Role] };
  }
  // Unknown role: bounce to /login. Should never happen with the seeded
  // role enum, but the layout shouldn't render for an undefined-role row.
  return { allow: false, redirectTo: '/login' };
}
