// =============================================================================
// HVA-327: one description of who a notification_rules row can target
// =============================================================================
//
// Two places used to answer "can this rule reach this user":
//
//   * lib/notifications/engine.ts:resolveRecipients — the switch that
//     actually delivers.
//   * lib/notifications/preferences.ts:ROLE_TO_RECIPIENT_ROLES — what the
//     /profile/notifications settings page lists.
//
// They drifted. `support_team_all` shipped in the engine (HVA-240) and went
// live in notification_rules, but the preferences map still carried
// `support: []` with a comment saying support had no tags yet. Support staff
// received notifications they could not see listed, toggle, or turn off.
//
// This module is now the single description. `preferences.ts` imports the
// map instead of declaring its own, and tests/notifications/
// recipient-role-coverage.test.ts asserts that every role the engine can
// resolve is either reachable from an app role or explicitly recorded as
// context-only — so the next recipient role cannot silently become
// unmanageable.
//
// NOTE: preferences.ts is a 'use server' module and may only export async
// functions, which is why these constants live here rather than beside
// their only consumer.
// =============================================================================

import type { Role } from '@/lib/auth/roles';

/**
 * Every `recipient_role` value `resolveRecipients` knows how to resolve.
 *
 * Kept in the same order as the switch arms in engine.ts. The coverage test
 * parses that switch and fails if the two lists diverge — adding a case to
 * the engine without listing it here is a test failure, not a silent gap.
 */
export const ENGINE_RECIPIENT_ROLES = [
  'exec',
  'exec_assigned',
  'captain_assigning',
  'captain_acting',
  'exec_removed',
  'captain_owning_city',
  'customer',
  'super_admin',
  'support_team_all',
  'mentioned_users',
  // HVA-342: replaces 'assist_submitter' and 'assist_team_captain'.
  'dispatch_request_submitter',
] as const;

export type EngineRecipientRole = (typeof ENGINE_RECIPIENT_ROLES)[number];

/**
 * App role → the `recipient_role` values that can target this user, and so
 * the rules they may manage on /profile/notifications.
 *
 * Mirrors engine.ts:resolveRecipients. A role listed here is one the user
 * can stand in for by virtue of WHO THEY ARE (their role, their assignment,
 * their team) — not by virtue of a per-event payload.
 */
export const ROLE_TO_RECIPIENT_ROLES: Record<Role, readonly string[]> = {
  // `exec` is the self-targeting variant (day-close reminder, warnings);
  // `exec_assigned` is "about a request you hold". Both land on the same
  // person via context.execUserId, so both belong to this role.
  sales_executive: [
    'exec',
    'exec_assigned',
    'exec_removed',
    'dispatch_request_submitter',
  ],
  // HVA-342: 'assist_team_captain' dropped — the captain is no longer part
  // of the material-request path, so there is no rule for them to manage.
  captain: ['captain_owning_city', 'captain_assigning', 'captain_acting'],
  super_admin: ['super_admin'],
  // HVA-327: was `[]`. The engine has resolved this since HVA-240 and
  // production rules use it, so the settings page was hiding live
  // notifications from the people receiving them.
  support: ['support_team_all'],
};

/**
 * Recipient roles that are deliberately NOT manageable from a user's
 * settings page, with the reason. Anything here is excluded on purpose;
 * anything neither here nor in ROLE_TO_RECIPIENT_ROLES is a gap.
 */
export const CONTEXT_ONLY_RECIPIENT_ROLES: Readonly<
  Record<string, string>
> = {
  // Not an app user — resolved to a phone number or email address, so
  // there is no account to hold a preference row.
  customer: 'resolved to a customer phone/email, not a user account',
  // Resolved from context.mentionedUserIds per comment. Any role can be
  // mentioned, so it cannot be listed as a standing subscription — and
  // opting out of being @mentioned is not a setting we offer.
  mentioned_users: 'per-comment fan-out from the payload, not a standing rule',
};
