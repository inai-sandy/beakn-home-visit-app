'use server';

import { eq } from 'drizzle-orm';
import { headers as headersFn } from 'next/headers';
import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import { sessions } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { auth } from '@/lib/auth';
import { isRole, type Role } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import { log } from '@/lib/logger';

// HVA-28: production logout server action.
//
// Cleanup is intentionally layered. Any one of (1) (2) (3) is sufficient to
// invalidate the session, but doing all three insulates us from Better-Auth
// integration quirks (e.g. cookies() being write-able only in specific
// runtime contexts, or BA's signOut silently no-op'ing if the cookie reader
// can't find the token). Each step is idempotent and try/caught so failure
// of one doesn't strand the user with a half-logout.
//
// Audit row is non-blocking by lib/audit contract — never throws. Whether it
// actually persists depends on `audit_enabled_events` config containing
// 'logout'.

export async function logoutAction(): Promise<void> {
  const reqHeaders = await headersFn();
  const session = await getServerSession();

  // Idempotent: an already-signed-out caller still gets redirected.
  if (!session) {
    redirect('/login?signedOut=1');
  }

  const userId = session.user.id;
  const userRole = (session.user as { role?: string }).role;
  const sessionId = session.session.id;

  // 1. Better-Auth's signOut: deletes the session row via the configured
  //    drizzle adapter AND clears the session cookie via Set-Cookie. This
  //    is the canonical path and should suffice in healthy cases.
  try {
    await auth.api.signOut({ headers: reqHeaders });
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err), userId },
      'logout_ba_signOut_failed',
    );
  }

  // 2. Belt-and-braces direct delete by session id, in case (1) raised or
  //    its cookie-clear ran but its DB-delete didn't. Idempotent — if BA
  //    already deleted the row, this affects zero rows. Even if the cookie
  //    survives in the browser, an absent session row makes proxy.ts treat
  //    the next request as unauthenticated.
  try {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  } catch (err) {
    log.error(
      {
        err: err instanceof Error ? err.message : String(err),
        userId,
        sessionId,
      },
      'logout_db_delete_failed',
    );
  }

  // 3. Audit. logEvent never throws (lib/audit.ts contract); silently drops
  //    if 'logout' isn't in audit_enabled_events.
  await logEvent({
    eventType: 'logout',
    actorUserId: userId,
    actorRole: isRole(userRole) ? (userRole as Role) : undefined,
    targetEntityType: 'user',
    targetEntityId: userId,
    afterState: { sessionId },
    ipAddress:
      reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      reqHeaders.get('x-real-ip') ??
      null,
    userAgent: reqHeaders.get('user-agent'),
  });

  redirect('/login?signedOut=1');
}
