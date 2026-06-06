import { asc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import { users } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { USER_ROLES } from '@/lib/auth/roles';

import { SupportUsersClient } from './support-client';

// =============================================================================
// HVA-236 (HVA-235-FIX1): /admin/settings/organization/support
// =============================================================================
//
// Mirrors /admin/settings/organization/executives but simpler — no
// captain/city assignment for support (global pool).

export const dynamic = 'force-dynamic';

export default async function SupportUsersAdminPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/settings/organization/support');
  const user = session.user as { id: string; role?: string };
  if (user.role !== USER_ROLES.SUPER_ADMIN) redirect('/admin/dashboard');

  const rows = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      phone: users.phone,
      email: users.email,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.role, USER_ROLES.SUPPORT))
    .orderBy(asc(users.fullName));

  const serialised = rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    phone: r.phone,
    email: r.email,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Support Team</h1>
          <p className="text-sm text-muted-foreground">
            {serialised.length}{' '}
            {serialised.length === 1 ? 'member' : 'members'} total.{' '}
            Support handles item dispatch + fulfillment across all cities.
          </p>
        </header>

        <SupportUsersClient users={serialised} />
      </div>
    </main>
  );
}
