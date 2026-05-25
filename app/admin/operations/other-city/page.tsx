import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { getServerSession } from '@/lib/auth-server';
import {
  loadActiveCaptainsForRouting,
  loadOtherCityQueue,
} from '@/lib/admin/other-city-queue';

import { OtherCityQueueClient } from './other-city-client';

// =============================================================================
// HVA-95: /admin/operations/other-city — manual routing for out-of-area
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Other-city Queue — Admin',
};

export default async function AdminOtherCityQueuePage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/operations/other-city');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') redirect('/admin/dashboard');

  const [requests, captains] = await Promise.all([
    loadOtherCityQueue(),
    loadActiveCaptainsForRouting(),
  ]);

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">
            Other-city Queue
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Requests submitted from outside the 8 service cities. Manually
            route each one to a captain. Captain will then assign to their
            sales exec via the normal flow.
          </p>
        </header>
        <OtherCityQueueClient requests={requests} captains={captains} />
      </div>
    </main>
  );
}
