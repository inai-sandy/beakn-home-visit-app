import { headers } from 'next/headers';

import { auth } from './auth';

export type ServerSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

/**
 * Read the current session from the request cookies. Returns null when
 * unauthenticated, expired, or any DB error short-circuits the lookup
 * (caller is expected to handle null as "anonymous").
 *
 * Cheap to call: BA caches per-request at the adapter level. Safe to call
 * from multiple Server Components in the same render.
 */
export async function getServerSession(): Promise<ServerSession | null> {
  const result = await auth.api.getSession({ headers: await headers() });
  return result ?? null;
}

/**
 * Server-side guard. Throws if there's no session or if the session's
 * user has a role not in `allowedRoles` (when supplied). Returns the
 * resolved session on success.
 *
 *   const session = await requireAuth(['captain', 'super_admin']);
 *
 * HVA-25's proxy.ts middleware uses a near-identical check at the HTTP
 * layer; this helper is for any inner code path that needs to assert
 * auth without relying on the middleware (cron triggers, server actions
 * outside the route tree, etc.).
 */
export async function requireAuth(allowedRoles?: readonly string[]): Promise<ServerSession> {
  const session = await getServerSession();
  if (!session) {
    throw new UnauthorizedError('Not signed in');
  }
  if (allowedRoles && allowedRoles.length > 0) {
    const role = (session.user as { role?: string }).role;
    if (!role || !allowedRoles.includes(role)) {
      throw new ForbiddenError(`Role "${role ?? '?'}" not allowed`);
    }
  }
  return session;
}

export class UnauthorizedError extends Error {
  status = 401 as const;
  constructor(msg = 'Unauthorized') {
    super(msg);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  status = 403 as const;
  constructor(msg = 'Forbidden') {
    super(msg);
    this.name = 'ForbiddenError';
  }
}
