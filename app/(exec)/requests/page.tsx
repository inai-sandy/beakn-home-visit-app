import { desc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import { cities, statusStages, visitRequests } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';

import {
  RequestsFilterClient,
  type SerializedRequestRow,
} from './_components/RequestsFilterClient';

// =============================================================================
// HVA-65: /requests for sales execs
// =============================================================================
//
// Lists every visit_request assigned to the current exec. Bucket
// selection + name/phone search happen client-side (locked decisions #7
// and #8) — the server hands the full row set down once and the client
// island filters in memory.
//
// AUTH (defence-in-depth; proxy.ts also gates by role):
//   - sales_executive → own assignments
//   - super_admin     → renders an empty list (intentional escape hatch
//                        mirroring HVA-103; admins should use
//                        /captain/requests for a wider view)
//   - captain         → bounced to /captain/requests
//   - anonymous       → bounced to /login
//
// Sort: assigned_at DESC NULLS LAST, then created_at DESC. Matches the
// /today ordering from HVA-103 so a row's position is stable across
// "Today" and "Requests" surfaces.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Requests — Beakn',
  description: 'Your assigned requests.',
};

export default async function ExecRequestsPage() {
  const session = await getServerSession();
  if (!session) {
    redirect('/login?next=/requests');
  }

  const user = session.user as { id: string; role?: string };

  // Captain bouncing — proxy.ts doesn't gate /requests explicitly, so a
  // captain who navigates here would otherwise render an empty exec
  // page. Redirect to their list page instead.
  if (user.role === 'captain') {
    redirect('/captain/requests');
  }
  if (user.role !== 'sales_executive' && user.role !== 'super_admin') {
    redirect('/login');
  }

  const rows = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      cityName: cities.name,
      statusCode: statusStages.code,
      statusName: statusStages.name,
      assignedExecUserId: visitRequests.assignedExecUserId,
      cancelledAt: visitRequests.cancelledAt,
      createdAt: visitRequests.createdAt,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(eq(visitRequests.assignedExecUserId, user.id))
    .orderBy(desc(visitRequests.createdAt));

  // Serialise Date fields for the RSC → client boundary. RequestsFilterClient
  // rehydrates them.
  const serialized: SerializedRequestRow[] = rows.map((r) => ({
    ...r,
    cancelledAt: r.cancelledAt === null ? null : r.cancelledAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-5 md:max-w-5xl">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {rows.length === 0
              ? 'No assignments yet.'
              : `${rows.length} assigned ${rows.length === 1 ? 'request' : 'requests'}.`}
          </p>
        </header>

        <RequestsFilterClient rows={serialized} />
      </div>
    </main>
  );
}
