'use server';

import { hashPassword } from 'better-auth/crypto';
import { and, eq, ne } from 'drizzle-orm';

import { db } from '@/db/client';
import { accounts, sessions, users } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { getServerSession } from '@/lib/auth-server';
import { setPasswordSchema, type SetPasswordInput } from '@/lib/validators/auth';

// =============================================================================
// HVA-26: first-login set-password Server Action
// =============================================================================
//
// Why we bypass Better-Auth's built-in flows:
//   - `auth.api.changePassword` REQUIRES the current (temp) password. The user
//     just logged in with it but we don't stash it in client state — asking
//     them to re-type would be a UX regression for the "set your password"
//     intent.
//   - `auth.api.setPassword` is documented as "for users WITHOUT existing
//     passwords (OAuth-only accounts)". Our users have a temp password row,
//     so behaviour with an existing credential row is undocumented.
//
// Path C (this file): a server action gated by (1) auth session, (2)
// mustChangePassword=true. Under those preconditions the user is exactly the
// person we want to let through. Does the password hash + the
// must_change_password flip in a single Drizzle transaction so a failure
// halfway can't leave the user in a "new password but still pinned" or
// "pin lifted but old password still works" state.
//
// Belt-and-braces: also deletes every OTHER session for this user so the
// temp-password session (the one they're using right now) is the only one
// alive. Defends against a stale device that signed in with the temp
// continuing to roam after the change.

export type SetPasswordResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string };

const ROLE_HOME: Record<string, string> = {
  sales_executive: '/today',
  captain: '/captain/dashboard',
  super_admin: '/admin/dashboard',
};

export async function setPasswordAction(
  input: SetPasswordInput,
): Promise<SetPasswordResult> {
  // 1. Re-validate server-side. Client form already validates but never trust.
  const parsed = setPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  // 2. Session gate.
  const session = await getServerSession();
  if (!session) {
    return { ok: false, error: 'Not signed in' };
  }
  const user = session.user as {
    id: string;
    role?: string;
    mustChangePassword?: boolean;
  };

  // 3. must_change_password gate. If false, the user shouldn't be here —
  //    refuse rather than silently no-op so a bug in the proxy is loud.
  if (!user.mustChangePassword) {
    return {
      ok: false,
      error: 'Your password has already been set. Refresh to continue.',
    };
  }

  // 4. Hash the new password using BA's scrypt impl (matches sign-in's verify).
  const hashed = await hashPassword(parsed.data.newPassword);

  // 5. Atomic flip: update both the credential row and the user flag.
  //    The session row we're using stays alive (so the user proceeds without
  //    re-login); every other session for this user is wiped.
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(accounts)
        .set({ password: hashed, updatedAt: new Date() })
        .where(
          and(eq(accounts.userId, user.id), eq(accounts.providerId, 'credential')),
        );

      await tx
        .update(users)
        .set({
          mustChangePassword: false,
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      await tx
        .delete(sessions)
        .where(
          and(eq(sessions.userId, user.id), ne(sessions.id, session.session.id)),
        );
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unexpected error',
    };
  }

  // 6. Audit (fire-and-forget; never throws). HVA-25 wires actor context once
  //    middleware injection lands; for now the actor is the session user.
  await logEvent({
    eventType: 'password_set',
    actorUserId: user.id,
    actorRole: user.role as 'sales_executive' | 'captain' | 'super_admin' | undefined,
    targetEntityType: 'user',
    targetEntityId: user.id,
    afterState: { mustChangePassword: false, sessionsRevokedExceptCurrent: true },
    reason: 'first_login_password_change',
  });

  // 7. Tell the client where to go. Per AC: not configurable via ?next= —
  //    completion always lands on role home.
  const redirectTo = (user.role && ROLE_HOME[user.role]) || '/';
  return { ok: true, redirectTo };
}
