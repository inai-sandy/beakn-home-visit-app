import { and, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { dayPlans } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { getIstDateString } from '@/lib/today/time';

// =============================================================================
// HVA-169: GET /api/auth/post-login-destination
// =============================================================================
//
// The login form (app/login/login-form.tsx) previously had a hard-coded
// client-side `ROLE_HOME[role]` map. HVA-169 needs the sales_executive
// destination to depend on a server-side DB read (does a day_plans row
// exist for the current IST date?), so the client hits this endpoint
// AFTER the Better-Auth sign-in returns 200 and follows the returned
// destination.
//
// Returns { destination: string }. For non-exec roles or any failure
// the fallback is the legacy ROLE_HOME default — the client also keeps
// its own ROLE_HOME map so a missed call here just lands the exec on
// /today (safe default; matches pre-HVA-169 behaviour).
//
// No bearer; the user's own session cookie is the auth. Role gating
// happens via the session itself.
// =============================================================================

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession();
  if (!session) {
    return Response.json({ destination: '/login' }, { status: 401 });
  }

  const user = session.user as { id: string; role?: string };
  switch (user.role) {
    case 'captain':
      return Response.json({ destination: '/captain/dashboard' });
    case 'super_admin':
      return Response.json({ destination: '/admin/dashboard' });
    // HVA-237: support team — landing on /support (the dispatch queue).
    // Previously fell through to `default` and got bounced to the public
    // /request form. HVA-235 added the role but missed this hardcoded
    // switch (the role's ROLE_HOME is correctly /support).
    case 'support':
      return Response.json({ destination: '/support' });
    case 'sales_executive': {
      const istToday = getIstDateString();
      const [row] = await db
        .select({ id: dayPlans.id })
        .from(dayPlans)
        .where(and(eq(dayPlans.execUserId, user.id), eq(dayPlans.planDate, istToday)))
        .limit(1);
      // No plan today → still need to submit → /today.
      // Plan submitted (closed or not) → land on analytical surface.
      return Response.json({ destination: row ? '/dashboard' : '/today' });
    }
    default:
      return Response.json({ destination: '/' });
  }
}
