import { NextResponse } from 'next/server';

import { USER_ROLES } from '@/lib/auth/roles';
import {
  ForbiddenError,
  requireAuth,
  UnauthorizedError,
} from '@/lib/auth-server';

// =============================================================================
// HVA-91/92: requireSuperAdmin — shared 401/403 wrapper for admin API routes
// =============================================================================
//
// Every /api/admin/* handler starts the same way: assert the actor is
// super_admin or return the right error code. requireAuth() throws
// Unauthorized/Forbidden; we map both to NextResponse.json so callers
// can early-return.
//
// Usage:
//   const guard = await requireSuperAdmin();
//   if (!guard.ok) return guard.response;
//   const actor = guard.session;
// =============================================================================

type SuperAdminSession = Awaited<ReturnType<typeof requireAuth>>;

export type SuperAdminGuardResult =
  | { ok: true; session: SuperAdminSession }
  | { ok: false; response: NextResponse };

export async function requireSuperAdmin(): Promise<SuperAdminGuardResult> {
  try {
    const session = await requireAuth([USER_ROLES.SUPER_ADMIN]);
    return { ok: true, session };
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: 'Unauthorized' },
          { status: 401 },
        ),
      };
    }
    if (err instanceof ForbiddenError) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: 'Forbidden' },
          { status: 403 },
        ),
      };
    }
    throw err;
  }
}
