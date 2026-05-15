import { count } from 'drizzle-orm';

import { db } from '@/db/client';
import { accounts, sessions, users } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

// Surfaces the Better-Auth integration health: total counts in the auth
// tables + the caller's own session (if any). Doesn't reveal any secret
// material — just shape + connectivity signals.

export default async function AuthHealthPage() {
  const [usersCount] = await db.select({ value: count() }).from(users);
  const [sessionsCount] = await db.select({ value: count() }).from(sessions);
  const [accountsCount] = await db.select({ value: count() }).from(accounts);
  const session = await getServerSession();

  const payload = {
    authConfigured: true,
    counts: {
      users: usersCount?.value ?? 0,
      sessions: sessionsCount?.value ?? 0,
      accounts: accountsCount?.value ?? 0,
    },
    yourSession: session
      ? {
          userId: session.user?.id ?? null,
          role: (session.user as { role?: string }).role ?? null,
          email: session.user?.email ?? null,
          phone: (session.user as { phone?: string }).phone ?? null,
          expiresAt: session.session?.expiresAt ?? null,
        }
      : null,
  };

  return (
    <main className="p-8 font-mono text-sm space-y-4">
      <h1 className="text-lg font-semibold">Auth service health</h1>
      <p className="text-muted-foreground">
        Better-Auth is configured. Send a POST to{' '}
        <code>/api/auth/sign-in/phone-number</code> (or use the <code>/login</code>{' '}
        form) to create a session. For ad-hoc verification, seed a throwaway
        admin via <code>pnpm db:seed:test-admin</code> (requires{' '}
        <code>TEST_ADMIN_PHONE</code> + <code>TEST_ADMIN_PASSWORD</code> env vars).
      </p>
      <pre className="bg-muted p-4 rounded-md">{JSON.stringify(payload, null, 2)}</pre>
    </main>
  );
}
