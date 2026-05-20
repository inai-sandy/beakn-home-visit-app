import { asc, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Pagination } from '@/components/lists/Pagination';
import { db } from '@/db/client';
import { businessTypes, cities } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { fetchExecLeads } from '@/lib/exec/leads-queries';
import { computePageRange, parsePage } from '@/lib/pagination';

import { LeadsFilterClient } from './_components/LeadsFilterClient';
import type { LeadRow } from './_components/types';

// =============================================================================
// HVA-73 + HVA-153: /leads — server-driven search + pagination
// =============================================================================
//
// Filter params land in the URL. The page reads them, runs the filtered
// + paginated query via fetchExecLeads, and renders the rows + the page
// navigation strip. Per-type counts come from a tiny supplementary
// query that re-runs the same WHERE except the type predicate, so the
// chip badges stay independent of the active type filter.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Contacts — Beakn',
};

type TypeFilter = 'all' | 'Customer' | 'Business';

function parseTypeFilter(raw: unknown): TypeFilter {
  if (raw === 'Customer' || raw === 'Business') return raw;
  return 'all';
}

interface PageProps {
  searchParams: Promise<{
    q?: string;
    type?: string;
    page?: string;
  }>;
}

export default async function LeadsPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/leads');

  const user = session.user as { id: string; role?: string };
  if (user.role === 'captain') redirect('/captain/dashboard');
  if (user.role !== 'sales_executive' && user.role !== 'super_admin') {
    redirect('/login');
  }

  const params = await searchParams;
  const q = (params.q ?? '').trim();
  const typeFilter = parseTypeFilter(params.type);
  const page = parsePage(params.page);

  const { rows, total, visibility } = await fetchExecLeads({
    execUserId: user.id,
    search: q || undefined,
    typeFilter: typeFilter === 'all' ? undefined : typeFilter,
    page,
  });

  // Per-type counts for the chip badges. We run two cheap supplementary
  // queries (Customer + Business) using fetchExecLeads with page-size 0
  // would be wasteful, so just fire two count-only fetches.
  const [customerTotal, businessTotal, allTotal] = await Promise.all([
    typeFilter === 'Customer'
      ? Promise.resolve(total)
      : fetchExecLeads({
          execUserId: user.id,
          search: q || undefined,
          typeFilter: 'Customer',
          page: 1,
          pageSize: 1,
        }).then((r) => r.total),
    typeFilter === 'Business'
      ? Promise.resolve(total)
      : fetchExecLeads({
          execUserId: user.id,
          search: q || undefined,
          typeFilter: 'Business',
          page: 1,
          pageSize: 1,
        }).then((r) => r.total),
    typeFilter === 'all'
      ? Promise.resolve(total)
      : fetchExecLeads({
          execUserId: user.id,
          search: q || undefined,
          page: 1,
          pageSize: 1,
        }).then((r) => r.total),
  ]);

  // Dropdown data for the Add Lead + Plan a Visit sheets — unchanged.
  const [cityRows, businessTypeRows] = await Promise.all([
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

  // Serialize rows to the LeadRow shape the existing UI expects.
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
    capturedDate: r.capturedDate,
    createdAt: r.createdAt,
    convertedToRequestId: r.convertedToRequestId,
    convertedAt: r.convertedAt,
    requestCount: r.requestCount,
    capturedByUserId: r.capturedByUserId,
    capturedByName: r.capturedByName,
    visibilityReason: r.visibilityReason,
  }));

  const range = computePageRange({ total, page });
  void visibility;

  return (
    <main className="min-h-svh bg-background">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-5 md:max-w-5xl">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total === 0
              ? 'No contacts visible to you yet.'
              : `${total} ${total === 1 ? 'contact' : 'contacts'} (captured by you or assigned).`}
          </p>
        </header>

        <LeadsFilterClient
          rows={serialized}
          cities={cityRows}
          businessTypes={businessTypeRows}
          initial={{ q, type: typeFilter }}
          typeCounts={{
            all: allTotal,
            Customer: customerTotal,
            Business: businessTotal,
          }}
        />

        {range.totalPages > 1 && (
          <Pagination
            pathname="/leads"
            page={range.page}
            totalPages={range.totalPages}
            from={range.from}
            to={range.to}
            total={range.total}
          />
        )}
      </div>
    </main>
  );
}
