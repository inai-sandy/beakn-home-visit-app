import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import Link from 'next/link';
import type { Metadata } from 'next';

import { db } from '@/db/client';
import {
  cities,
  statusStages,
  users,
  visitRequests,
} from '@/db/schema';
import { Badge } from '@/components/ui/badge';

import { ViewOnlyNotice } from '../_components/ViewOnlyNotice';

// MVP mirror of /captain/requests scoped to the captain's owned cities.
// Lists active (non-cancelled, non-terminal) requests with customer,
// city, stage, and assigned exec. Filter/pagination polish follows.

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Requests — Beakn admin',
};

export default async function AdminPortalRequestsPage({
  params,
}: {
  params: Promise<unknown>;
}) {
  const { captainId } = (await params) as { captainId: string };

  // Captain's owned cities — same scope rule as /captain/requests.
  const myCities = await db
    .select({ id: cities.id, name: cities.name })
    .from(cities)
    .where(eq(cities.captainUserId, captainId));
  const cityIds = myCities.map((c) => c.id);
  const cityNameById = new Map(myCities.map((c) => [c.id, c.name]));

  let rows: Array<{
    id: string;
    customerName: string;
    customerPhone: string;
    createdAt: Date;
    cityId: string;
    statusCode: string;
    statusName: string;
    assignedExecName: string | null;
  }> = [];
  if (cityIds.length > 0) {
    rows = await db
      .select({
        id: visitRequests.id,
        customerName: visitRequests.customerName,
        customerPhone: visitRequests.customerPhone,
        createdAt: visitRequests.createdAt,
        cityId: visitRequests.cityId,
        statusCode: statusStages.code,
        statusName: statusStages.name,
        assignedExecName: users.fullName,
      })
      .from(visitRequests)
      .innerJoin(
        statusStages,
        eq(statusStages.id, visitRequests.statusStageId),
      )
      .leftJoin(users, eq(users.id, visitRequests.assignedExecUserId))
      .where(
        and(
          inArray(visitRequests.cityId, cityIds),
          isNull(visitRequests.cancelledAt),
          ne(statusStages.code, 'ORDER_EXECUTED_SUCCESSFULLY'),
        ),
      )
      .orderBy(desc(visitRequests.createdAt))
      .limit(100);
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Active requests in this captain's {myCities.length} {myCities.length === 1 ? 'city' : 'cities'}.
        </p>
      </header>
      <ViewOnlyNotice />
      {rows.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No active requests in this captain's cities right now.
          </p>
        </div>
      ) : (
        <ul className="space-y-2" aria-label="Requests">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/requests/${r.id}`}
                className="block rounded-2xl border bg-card p-4 hover:bg-accent/30 transition-colors"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold tracking-tight truncate">
                      {r.customerName}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {r.customerPhone} · {cityNameById.get(r.cityId) ?? '—'}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="text-[10px] uppercase tracking-wide shrink-0"
                  >
                    {r.statusName}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {r.assignedExecName ? `Assigned to ${r.assignedExecName}` : 'Unassigned'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
