import { userRoleEnum } from '@/db/schema';

// =============================================================================
// HVA-107: typed role primitives — single source of truth
// =============================================================================
//
// Everything in this module derives from `userRoleEnum.enumValues` so the
// values stay locked to the Drizzle schema. If the DB enum ever gains
// (or loses) a role, TypeScript will surface every consumer that needs
// to be updated.
//
// Background: HVA-106's audit confirmed every shipped role gate already
// uses the correct string. This module isn't a fix — it's a type-discipline
// upgrade so future drift fails at compile time instead of silently
// passing a wrong-string comparison (e.g. `role === 'sales_exec'` would
// have been a runtime no-op; with `Role` it's a type error).
//
// USAGE:
//   import { Role, USER_ROLES, ROLE_HOME } from '@/lib/auth/roles';
//
//   if (role === USER_ROLES.SUPER_ADMIN) return true;          // gate
//   const target = ROLE_HOME[role];                            // routing
//   const allowed: readonly Role[] = [USER_ROLES.CAPTAIN, ...]; // arrays
//
// =============================================================================

/** The complete set of role values, exactly as the DB enum stores them. */
export const USER_ROLES = {
  SUPER_ADMIN: 'super_admin',
  CAPTAIN: 'captain',
  SALES_EXECUTIVE: 'sales_executive',
  // HVA-235: dispatch / fulfillment team for the new Support Portal v1.
  SUPPORT: 'support',
} as const satisfies Record<string, (typeof userRoleEnum.enumValues)[number]>;

/**
 * Union type of valid role string values. Derived from the Drizzle enum so
 * adding/removing a role at the schema layer surfaces as a `Role` error in
 * every consumer that hasn't updated. Equivalent to
 * `'super_admin' | 'captain' | 'sales_executive'`.
 */
export type Role = (typeof userRoleEnum.enumValues)[number];

/**
 * Landing page each role lands on after authentication. Centralised here so
 * the proxy redirect, the /set-password success redirect, and the
 * /set-password page-level "already done" redirect agree by construction.
 * `Record<Role, string>` forces exhaustive coverage — adding a new role
 * surfaces as a type error here first.
 */
export const ROLE_HOME: Record<Role, string> = {
  super_admin: '/admin/dashboard',
  captain: '/captain/dashboard',
  sales_executive: '/today',
  // HVA-235: support team's landing page is the dispatch queue.
  support: '/support',
};

/** Narrow an unknown string to `Role`. Mostly useful at HTTP/session boundaries. */
export function isRole(value: unknown): value is Role {
  return (
    typeof value === 'string' &&
    (userRoleEnum.enumValues as readonly string[]).includes(value)
  );
}
