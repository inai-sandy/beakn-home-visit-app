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
// /exec/reports/graphs — exec-scoped graphs view (HVA-226 + HVA-227)
// =============================================================================
//
// Same 6 charts as /admin/reports/graphs, scoped to the exec themself.
// Exec sees only requests where `assigned_exec_user_id` = caller id.
// The "Top execs" chart degrades to a single bar in this scope. HVA-227:
// URL-driven date range (?from=&to=); falls back to 30 days.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Graphs — My performance',
};

function isValidIstDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ExecReportsGraphsPage({
  searchParams,
}: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/exec/reports/graphs');
  const user = session.user as { id: string; role?: string };
  if (
    user.role !== 'sales_executive' &&
    user.role !== 'captain' &&
    user.role !== 'super_admin'
  ) {
    redirect('/login');
  }

  const sp = await searchParams;
  const istToday = getIstDateString();
  const defaults = defaultReportRange(istToday);
  const fromRaw = Array.isArray(sp.from) ? sp.from[0] : sp.from;
  const toRaw = Array.isArray(sp.to) ? sp.to[0] : sp.to;
  const fromDate = isValidIstDate(fromRaw) ? fromRaw : defaults.fromDate;
  const toDate = isValidIstDate(toRaw) ? toRaw : defaults.toDate;
  const range =
    fromDate <= toDate
      ? { fromDate, toDate }
      : { fromDate: toDate, toDate: fromDate };

  const bundle = await loadGraphsBundle({
    scope: { kind: 'exec', execUserId: user.id },
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
        href="/exec/reports"
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
          My performance
        </h1>
        <p className="text-sm text-muted-foreground">
          Only the requests assigned to you.
        </p>
      </header>

      <GraphsDateRangeFilter
        fromDate={range.fromDate}
        toDate={range.toDate}
        istToday={istToday}
      />

      <GraphsView
        bundle={bundle}
        scope={{ kind: 'exec', execUserId: user.id }}
        windowLabel={`the ${dayCount} day${dayCount === 1 ? '' : 's'} from ${range.fromDate} to ${range.toDate}`}
      />
    </main>
  );
}
