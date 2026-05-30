'use server';

import { APIError } from 'better-auth/api';
import { and, eq, ne, sql } from 'drizzle-orm';
import { headers as headersFn } from 'next/headers';

import { db } from '@/db/client';
import { sessions } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { auth } from '@/lib/auth';
import { isRole, type Role } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import { log } from '@/lib/logger';
import {
  changePasswordSchema,
  type ChangePasswordInput,
} from '@/lib/validators/auth';

// =============================================================================
// HVA-29: Change-Password Server Action
// =============================================================================
//
// Lives under /app/dev/change-password-test/ because the spec'd home — the
// Profile screen — ships in HVA-76 and doesn't exist yet. When HVA-76 lands,
// MOVE this file and the form/page siblings into the Profile route. Action
// is route-agnostic; no logic depends on /dev/change-password-test/* paths.
//
// HASH ALGORITHM:
// Linear's HVA-29 body says "bcrypt hash" — IGNORED, deliberately. HVA-25
// shipped scrypt (Better-Auth's default, see lib/auth.ts §"Deviations" head
// comment). The credential rows in `accounts` are all scrypt envelopes
// today. Switching this single action to bcrypt would (a) silently break
// sign-in for every user whose password was changed via this flow, and
// (b) fragment hashing strategy across the codebase. Sticking with scrypt
// to keep the verify path on sign-in working. Documented in the HVA-29 PR
// + completion summary.
//
// FLOW:
//   1. Re-validate input against the same zod schema the client used. Never
//      trust client-side validation alone.
//   2. Session gate — must be signed in. (No must_change_password gate;
//      this flow is *intentional*, not pinned.)
//   3. Delegate to `auth.api.changePassword({ currentPassword, newPassword })`
//      WITHOUT `revokeOtherSessions: true`. BA verifies the current pwd
//      against the stored scrypt envelope, rehashes the new one, and
//      updates the `accounts` row. We hold session revocation locally so
//      we can guarantee the *current* session row is untouched.
//   4. On BA error (wrong current pwd, etc.): surface as a field-level
//      error on `currentPassword`. Generic message; never reveal whether
//      the user / hash exists.
//   5. Atomic-ish: separately delete every session row for this user OTHER
//      than the current one. AC#3 requires sessions on other devices to be
//      invalidated while the in-hand session remains valid (no forced
//      re-login of the user who just changed their own password).
//   6. Audit row: action 'password_changed' (flat snake_case — matches the
//      codebase convention set by HVA-28; Linear's casual `user.password_
//      changed` dot-prefix is descriptive, not a literal identifier).
//
// CONCURRENT-LOGIN CAVEAT:
// If the user changes their password mid-tab and another tab in the same
// browser is sharing the session, BOTH tabs survive — they share the same
// session row. Sibling browsers / mobile devices that signed in separately
// have their own session rows and DO get wiped.
// =============================================================================

export type ChangePasswordResult =
  | { ok: true; otherSessionsRevoked: number }
  | { ok: false; fieldError?: 'currentPassword'; error: string };

export async function changePasswordAction(
  input: ChangePasswordInput,
): Promise<ChangePasswordResult> {
  // 1. Server-side re-validation.
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }

  // 2. Session gate.
  const reqHeaders = await headersFn();
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: 'Not signed in' };
  }
  const userId = session.user.id;
  const userRole = (session.user as { role?: string }).role;
  const sessionId = session.session.id;

  // Count sessions BEFORE the change so we can report the delta in the
  // audit row's after_state. Acceptable to be a snapshot — between this
  // read and the delete below, BA might briefly create+drop rotation
  // rows, but the count we care about (other devices invalidated) is
  // stable.
  const beforeResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sessions)
    .where(eq(sessions.userId, userId));
  const beforeCount = beforeResult[0]?.count ?? 0;

  // 3. Delegate the verify + rehash to Better-Auth. This keeps us on the
  //    same scrypt envelope format the rest of the codebase uses and
  //    avoids reimplementing constant-time verification.
  try {
    await auth.api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        // Hold session revocation locally — see step 5.
        revokeOtherSessions: false,
      },
      headers: reqHeaders,
    });
  } catch (err) {
    // 4. Map BA errors to a useful field-level error. BA throws APIError
    //    with a status code on bad current password; surface that as a
    //    `currentPassword` field error so the form puts the message under
    //    the right input. Never reveal whether the user exists or
    //    differentiate "no credential row" from "wrong password" — both
    //    are the same UX outcome ("current password is incorrect").
    if (err instanceof APIError) {
      log.warn(
        {
          userId,
          status: err.status,
          msg: err.message,
        },
        'change_password_ba_error',
      );
      return {
        ok: false,
        fieldError: 'currentPassword',
        error: 'Current password is incorrect',
      };
    }
    log.error(
      { userId, err: err instanceof Error ? err.message : String(err) },
      'change_password_unexpected_error',
    );
    return {
      ok: false,
      error: 'Unexpected error. Try again.',
    };
  }

  // 5. Revoke OTHER sessions for this user. Idempotent: rows may already
  //    be gone if BA decided to rotate something. The `ne(sessionId)`
  //    guard protects the current session row from being deleted.
  let otherSessionsRevoked = 0;
  try {
    const deleted = await db
      .delete(sessions)
      .where(and(eq(sessions.userId, userId), ne(sessions.id, sessionId)))
      .returning({ id: sessions.id });
    otherSessionsRevoked = deleted.length;
  } catch (err) {
    log.error(
      {
        userId,
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      },
      'change_password_session_revoke_failed',
    );
    // Soft-fail the revoke: the password was already changed (step 3
    // committed). Returning ok=false here would lie to the user — the
    // password did change. Continue to the audit + ok response.
  }

  // 6. Audit. Fire-and-forget contract (lib/audit.ts) — never throws.
  await logEvent({
    eventType: 'password_changed',
    actorUserId: userId,
    actorRole: isRole(userRole) ? (userRole as Role) : undefined,
    targetEntityType: 'user',
    targetEntityId: userId,
    afterState: {
      otherSessionsRevoked,
      sessionsBeforeChange: beforeCount,
      currentSessionPreserved: sessionId,
    },
    reason: 'user_initiated_password_change',
    ipAddress:
      reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      reqHeaders.get('x-real-ip') ??
      null,
    userAgent: reqHeaders.get('user-agent'),
  });

  return { ok: true, otherSessionsRevoked };
}
