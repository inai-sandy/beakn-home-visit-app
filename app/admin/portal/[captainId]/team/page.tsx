import { and, asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';

import { db } from '@/db/client';
import { salesExecutives, users } from '@/db/schema';

import { ViewOnlyNotice } from '../_components/ViewOnlyNotice';

// Mirror of /captain/team scoped to URL captainId. Lists the captain's
// active exec roster. The full captain page has search + window
// toggle + per-exec status/metrics drill — those follow in a polish
// pass once Sandeep walks the MVP layout.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'My Team — Beakn admin',
};

export default async function AdminPortalTeamPage({
  params,
}: {
  params: Promise<unknown>;
}) {
  const { captainId } = (await params) as { captainId: string };

  const team = await db
    .select({
      userId: salesExecutives.userId,
      fullName: users.fullName,
      phone: users.phone,
      isActive: users.isActive,
    })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(
      and(
        eq(salesExecutives.captainUserId, captainId),
        eq(users.isActive, true),
      ),
    )
    .orderBy(asc(users.fullName));

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">My Team</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {team.length} active {team.length === 1 ? 'executive' : 'executives'}.
        </p>
      </header>
      <ViewOnlyNotice />
      {team.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            This captain has no active sales executives.
          </p>
        </div>
      ) : (
        <ul className="space-y-2" aria-label="Team members">
          {team.map((m) => (
            <li
              key={m.userId}
              className="rounded-2xl border bg-card p-4 flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-tight truncate">
                  {m.fullName}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {m.phone}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
