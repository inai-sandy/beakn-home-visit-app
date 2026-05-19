import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import {
  businessTypes,
  cities,
  leads,
  users,
  visitRequests,
} from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { loadExecVisibleContactSet } from '@/lib/exec/visible-contacts';

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

  // HVA-73 PR 3: visibility set = captor OR ever-assigned (current or
  // historical). Read the set once, then drive the list query off the
  // resolved ids.
  const visibility = await loadExecVisibleContactSet(user.id);

  // Fetch the contacts + dropdown options in parallel. Empty visibility
  // → skip the leads query (Drizzle's `inArray(col, [])` short-circuits
  // anyway, but the round-trip is wasted).
  const [rows, cityRows, businessTypeRows] = await Promise.all([
    visibility.ids.length === 0
      ? Promise.resolve([] as Array<{
          id: string;
          type: string;
          name: string;
          phone: string;
          email: string | null;
          cityId: string;
          cityName: string;
          bhk: string | null;
          firmName: string | null;
          businessTypeId: string | null;
          businessTypeName: string | null;
          interest: string[];
          notes: string | null;
          capturedByUserId: string;
          capturedByName: string | null;
          capturedDate: string;
          createdAt: Date;
          convertedToRequestId: string | null;
          convertedAt: Date | null;
        }>)
      : db
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
            capturedByUserId: leads.capturedByUserId,
            capturedByName: users.fullName,
            capturedDate: leads.capturedDate,
            createdAt: leads.createdAt,
            convertedToRequestId: leads.convertedToRequestId,
            convertedAt: leads.convertedAt,
          })
          .from(leads)
          .innerJoin(cities, eq(cities.id, leads.cityId))
          .leftJoin(businessTypes, eq(businessTypes.id, leads.businessTypeId))
          .innerJoin(users, eq(users.id, leads.capturedByUserId))
          .where(inArray(leads.id, visibility.ids))
          .orderBy(
            // Drizzle's `asc(x IS NOT NULL)` translates to ORDER BY (x IS
            // NOT NULL) ASC — FALSE sorts first so unconverted rows
            // (NULL) come before converted ones. Within each group,
            // newest first.
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
    // HVA-73 PR 3: surface captor identity so the row can render
    // "Captured by <other exec>" when the viewer isn't the captor.
    capturedByUserId: r.capturedByUserId,
    capturedByName: r.capturedByName ?? null,
    visibilityReason: visibility.reasons.get(r.id) ?? 'assignment',
  }));

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-5 md:max-w-5xl">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {rows.length === 0
              ? 'No contacts visible to you yet.'
              : `${rows.length} ${rows.length === 1 ? 'contact' : 'contacts'} (captured by you or assigned).`}
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
