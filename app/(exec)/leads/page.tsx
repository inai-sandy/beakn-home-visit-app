import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import {
  businessTypes,
  cities,
  leads,
  visitRequests,
} from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';

import { LeadsFilterClient } from './_components/LeadsFilterClient';
import type { LeadRow } from './_components/types';

// =============================================================================
// HVA-73: /leads — sales-exec leads list
// =============================================================================
//
// Server component. Fetches every lead captured by the current exec
// (super_admin sees nothing — leads are scoped to the captor, Phase 1
// per locked decision D5 in HVA-73 bundle) + the cities/business-types
// option lists for the Add/Convert sheets, then hands everything to the
// client wrapper.
//
// Sort: not-yet-converted first (most recent capture first), converted
// leads sink below (most recent conversion first). The bundle's D2
// "Converted leads sink below unconverted" is implemented as a two-key
// sort applied here at the SQL layer.
//
// AUTH (defence-in-depth; proxy.ts also gates by role):
//   - sales_executive → own captured leads
//   - super_admin     → empty list (no captor-of-record; future Phase 2
//                       could surface team rollups for admin)
//   - captain         → bounced to /captain/dashboard
//   - anonymous       → bounced to /login
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Contacts — Beakn',
};

export default async function LeadsPage() {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/leads');

  const user = session.user as { id: string; role?: string };
  if (user.role === 'captain') redirect('/captain/dashboard');
  if (user.role !== 'sales_executive' && user.role !== 'super_admin') {
    redirect('/login');
  }

  // Fetch the exec's leads + dropdown options in parallel.
  const [rows, cityRows, businessTypeRows] = await Promise.all([
    db
      .select({
        id: leads.id,
        type: leads.type,
        name: leads.name,
        phone: leads.phone,
        email: leads.email,
        cityId: leads.cityId,
        cityName: cities.name,
        bhk: leads.bhk,
        firmName: leads.firmName,
        businessTypeId: leads.businessTypeId,
        businessTypeName: businessTypes.name,
        interest: leads.interest,
        notes: leads.notes,
        capturedDate: leads.capturedDate,
        createdAt: leads.createdAt,
        convertedToRequestId: leads.convertedToRequestId,
        convertedAt: leads.convertedAt,
      })
      .from(leads)
      .innerJoin(cities, eq(cities.id, leads.cityId))
      .leftJoin(businessTypes, eq(businessTypes.id, leads.businessTypeId))
      .where(eq(leads.capturedByUserId, user.id))
      .orderBy(
        // Drizzle's `asc(x IS NOT NULL)` translates to ORDER BY (x IS NOT
        // NULL) ASC — FALSE sorts first so unconverted rows (NULL) come
        // before converted ones. Within each group, newest first.
        asc(leads.convertedToRequestId),
        desc(leads.createdAt),
      ),
    db
      .select({ id: cities.id, name: cities.name })
      .from(cities)
      .where(eq(cities.isActive, true))
      .orderBy(asc(cities.name)),
    db
      .select({ id: businessTypes.id, name: businessTypes.name })
      .from(businessTypes)
      .where(eq(businessTypes.isActive, true))
      .orderBy(asc(businessTypes.sequenceNumber)),
  ]);

  // HVA-73 PR 1: one aggregate query for request counts per contact.
  // Done in a second round-trip (kept out of the main Promise.all so
  // the leadIds are known). Empty lead list → skip the query entirely.
  const leadIds = rows.map((r) => r.id);
  const countMap = new Map<string, number>();
  if (leadIds.length > 0) {
    const counts = await db
      .select({
        contactId: visitRequests.contactId,
        count: sql<number>`count(*)::int`,
      })
      .from(visitRequests)
      .where(inArray(visitRequests.contactId, leadIds))
      .groupBy(visitRequests.contactId);
    for (const c of counts) {
      if (c.contactId) countMap.set(c.contactId, c.count);
    }
  }

  const serialized: LeadRow[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    phone: r.phone,
    email: r.email,
    cityId: r.cityId,
    cityName: r.cityName,
    bhk: r.bhk,
    firmName: r.firmName,
    businessTypeId: r.businessTypeId,
    businessTypeName: r.businessTypeName,
    interest: r.interest,
    notes: r.notes,
    // `capturedDate` is the date column; `createdAt` carries the
    // timestamp. UI shows relative time from createdAt, calendar from
    // capturedDate.
    capturedDate: r.capturedDate,
    createdAt: r.createdAt.toISOString(),
    convertedToRequestId: r.convertedToRequestId,
    convertedAt: r.convertedAt ? r.convertedAt.toISOString() : null,
    requestCount: countMap.get(r.id) ?? 0,
  }));

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-5 md:max-w-5xl">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {rows.length === 0
              ? 'No contacts captured yet.'
              : `${rows.length} ${rows.length === 1 ? 'contact' : 'contacts'} captured.`}
          </p>
        </header>

        <LeadsFilterClient
          rows={serialized}
          cities={cityRows}
          businessTypes={businessTypeRows}
        />
      </div>
    </main>
  );
}
