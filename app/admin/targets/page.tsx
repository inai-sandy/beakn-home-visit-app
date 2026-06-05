import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { TargetsTableFilters } from '@/components/targets/TargetsTableFilters';
import { TargetsTableView } from '@/components/targets/TargetsTableView';
import {
  DEFAULT_PAGE_SIZE,
  loadTargetsTable,
  type TargetsTableSort,
  type WarningStatusFilter,
} from '@/lib/admin/targets-table';
import { getServerSession } from '@/lib/auth-server';
import {
  getCurrentMonthWindow,
  loadMonthlyTargetPaise,
} from '@/lib/exec/target-progress';

// =============================================================================
// /admin/targets — unified team-targets table (HVA-229)
// =============================================================================
//
// Replaces the previous arena + AdminExecWarningRoster pair with one
// searchable, filterable, paginated table. Single source of truth for
// monthly target progress + active warnings per exec.
//
// URL params:
//   q          — free-text search (exec/captain/city)
//   captain    — captain user_id filter
//   city       — city name filter
//   status     — warning status filter ('none'|'has_soft'|'has_hard'|'fire')
//   sort       — column sort key
//   dir        — 'asc' | 'desc'
//   page       — 1-based pagination
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Team targets — Beakn admin',
};

const VALID_SORTS: TargetsTableSort[] = [
  'combined',
  'name',
  'orders',
  'revenue',
  'softActive',
  'hardActive',
];
const VALID_STATUSES: WarningStatusFilter[] = [
  'all',
  'none',
  'has_soft',
  'has_hard',
  'fire',
];

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readString(
  raw: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

export default async function AdminTargetsPage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/targets');
  const role = (session.user as { role?: string }).role;
  if (role !== 'super_admin') redirect('/login');

  const sp = await searchParams;
  const q = readString(sp.q) ?? '';
  const captainParam = readString(sp.captain) ?? 'all';
  const cityParam = readString(sp.city) ?? 'all';
  const statusRaw = readString(sp.status) ?? 'all';
  const status: WarningStatusFilter = (
    VALID_STATUSES as readonly string[]
  ).includes(statusRaw)
    ? (statusRaw as WarningStatusFilter)
    : 'all';
  const sortRaw = readString(sp.sort) ?? 'combined';
  const sort: TargetsTableSort = (
    VALID_SORTS as readonly string[]
  ).includes(sortRaw)
    ? (sortRaw as TargetsTableSort)
    : 'combined';
  const direction: 'asc' | 'desc' = readString(sp.dir) === 'asc' ? 'asc' : 'desc';
  const pageRaw = Number(readString(sp.page) ?? '1');
  const page =
    Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;

  const monthWindow = getCurrentMonthWindow();
  const monthlyTargetPaise = await loadMonthlyTargetPaise();
  const result = await loadTargetsTable({
    window: monthWindow,
    q: q.length > 0 ? q : undefined,
    captainId: captainParam !== 'all' ? captainParam : undefined,
    cityName: cityParam !== 'all' ? cityParam : undefined,
    status,
    sort,
    direction,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  // Preserve filter/sort state in the table's sort-header + paginator
  // links. We rebuild a URL search string from the resolved values so
  // the header links are stable across page renders.
  const stateParams = new URLSearchParams();
  if (q) stateParams.set('q', q);
  if (captainParam !== 'all') stateParams.set('captain', captainParam);
  if (cityParam !== 'all') stateParams.set('city', cityParam);
  if (status !== 'all') stateParams.set('status', status);
  stateParams.set('sort', sort);
  stateParams.set('dir', direction);

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Team targets</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monthly progress for every sales executive across the org. Click
          a name to drill into their warnings.
        </p>
      </header>

      <TargetsTableFilters
        q={q}
        captainId={captainParam}
        cityName={cityParam}
        status={status}
        captainFacets={result.captainFacets}
        cityFacets={result.cityFacets}
        basePath="/admin/targets"
      />

      <TargetsTableView
        result={result}
        window={monthWindow}
        monthlyTargetPaise={monthlyTargetPaise}
        searchString={stateParams.toString()}
        basePath="/admin/targets"
        currentSort={sort}
        currentDir={direction}
      />
    </main>
  );
}
