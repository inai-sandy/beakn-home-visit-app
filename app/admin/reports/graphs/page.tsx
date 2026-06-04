import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { GraphsDateRangeFilter } from '@/components/reports/graphs/GraphsDateRangeFilter';
import { GraphsView } from '@/components/reports/graphs/GraphsView';
import { Icon } from '@/components/ui/icon';
import { getServerSession } from '@/lib/auth-server';
import { loadGraphsBundle } from '@/lib/reports/graphs';
import { defaultReportRange } from '@/lib/reports/types';
import { getIstDateString } from '@/lib/today/time';

// =============================================================================
// /admin/reports/graphs — Sprint 4 graphs surface (HVA-226 + HVA-227)
// =============================================================================
//
// Curated 6-chart visual dashboard. Bundle loader runs the 6 queries in
// parallel server-side, then GraphsView hydrates each card client-side
// (recharts is client-only). HVA-227: URL-driven date range filter
// (`?from=YYYY-MM-DD&to=YYYY-MM-DD`); falls back to last-30-days when
// missing or malformed.
//
// Captain and exec mirror this page with a narrower scope; the chart
// components are identical.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Graphs — Beakn admin',
};

function isValidIstDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminReportsGraphsPage({
  searchParams,
}: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/reports/graphs');
  if ((session.user as { role?: string }).role !== 'super_admin') {
    redirect('/login');
  }

  const sp = await searchParams;
  const istToday = getIstDateString();
  const defaults = defaultReportRange(istToday);
  const fromRaw = Array.isArray(sp.from) ? sp.from[0] : sp.from;
  const toRaw = Array.isArray(sp.to) ? sp.to[0] : sp.to;
  const fromDate = isValidIstDate(fromRaw) ? fromRaw : defaults.fromDate;
  const toDate = isValidIstDate(toRaw) ? toRaw : defaults.toDate;
  // Clamp from <= to (defensive — client also clamps before submit).
  const range =
    fromDate <= toDate
      ? { fromDate, toDate }
      : { fromDate: toDate, toDate: fromDate };

  const bundle = await loadGraphsBundle({
    scope: { kind: 'global' },
    range,
  });

  const dayCount =
    Math.floor(
      (Date.UTC(
        Number(range.toDate.slice(0, 4)),
        Number(range.toDate.slice(5, 7)) - 1,
        Number(range.toDate.slice(8, 10)),
      ) -
        Date.UTC(
          Number(range.fromDate.slice(0, 4)),
          Number(range.fromDate.slice(5, 7)) - 1,
          Number(range.fromDate.slice(8, 10)),
        )) /
        86_400_000,
    ) + 1;

  return (
    <main className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      <Link
        href="/admin/reports"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Icon name="arrow_back" size="xs" />
        Back to reports
      </Link>

      <header className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground font-semibold">
          Reports — Graphs
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          Visual dashboard
        </h1>
        <p className="text-sm text-muted-foreground">
          Curated 6-chart view · all teams, all cities.
        </p>
      </header>

      <GraphsDateRangeFilter
        fromDate={range.fromDate}
        toDate={range.toDate}
        istToday={istToday}
      />

      <GraphsView
        bundle={bundle}
        scope={{ kind: 'global' }}
        windowLabel={`the ${dayCount} day${dayCount === 1 ? '' : 's'} from ${range.fromDate} to ${range.toDate}`}
      />
    </main>
  );
}
