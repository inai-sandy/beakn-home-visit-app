import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { getServerSession } from '@/lib/auth-server';
import { getIstDateString } from '@/lib/today/time';
import { parsePage } from '@/lib/pagination';
import {
  DRILLDOWN_META,
  DRILLDOWN_METRICS,
  loadKpiDrilldown,
  type DrilldownMetric,
} from '@/lib/admin/kpi-drilldown';

// =============================================================================
// HVA-292: admin KPI tile drill-down — /admin/dashboard/[metric]
// =============================================================================
//
// Clicking a top KPI tile lands here. Lists the actual records behind the
// number for the SAME window the tile used (passed as ?from / ?to), with
// search and pagination (20/page). Org-wide (super_admin scope).
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Drill-down — Beakn admin' };

const PAGE_SIZE = 20;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isMetric(s: string): s is DrilldownMetric {
  return (DRILLDOWN_METRICS as readonly string[]).includes(s);
}

function cleanDate(s: unknown, fallback: string): string {
  return typeof s === 'string' && DATE_PATTERN.test(s) ? s : fallback;
}

interface PageProps {
  params: Promise<{ metric: string }>;
  searchParams: Promise<{ from?: string; to?: string; q?: string; page?: string }>;
}

export default async function AdminKpiDrilldownPage({
  params,
  searchParams,
}: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/dashboard');
  const user = session.user as { role?: string };
  if (user.role !== 'super_admin') redirect('/login');

  const { metric } = await params;
  if (!isMetric(metric)) notFound();

  const sp = await searchParams;
  const istToday = getIstDateString();
  const fromDate = cleanDate(sp.from, istToday);
  const toDate = cleanDate(sp.to, istToday);
  const search = (sp.q ?? '').trim();
  const page = parsePage(sp.page);

  const meta = DRILLDOWN_META[metric];
  const { rows, total } = await loadKpiDrilldown(metric, {
    fromDate,
    toDate,
    search,
    page,
    pageSize: PAGE_SIZE,
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const windowLabel =
    fromDate === toDate ? fromDate : `${fromDate} → ${toDate}`;

  const qs = (p: number) => {
    const params = new URLSearchParams();
    params.set('from', fromDate);
    params.set('to', toDate);
    if (search) params.set('q', search);
    if (p > 1) params.set('page', String(p));
    return `?${params.toString()}`;
  };

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <div className="space-y-1">
        <Link
          href="/admin/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <Icon name="arrow_back" size="xs" />
          Back to dashboard
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{meta.title}</h1>
        <p className="text-xs text-muted-foreground">
          {windowLabel} · {total.toLocaleString('en-IN')} record
          {total === 1 ? '' : 's'}
        </p>
      </div>

      {/* Search — plain GET form, resets to page 1. */}
      <form method="GET" className="flex gap-2">
        <input type="hidden" name="from" value={fromDate} />
        <input type="hidden" name="to" value={toDate} />
        <Input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Search by customer / task…"
          className="h-10 max-w-xs"
        />
        <Button type="submit" variant="outline" size="sm">
          <Icon name="search" size="xs" />
          Search
        </Button>
        {search && (
          <Button asChild variant="ghost" size="sm">
            <Link href={qs(1).replace(/[?&]q=[^&]*/, '')}>Clear</Link>
          </Button>
        )}
      </form>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
              {meta.columns.map((c) => (
                <th key={c} className="px-4 py-2.5 font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-10 text-center text-sm text-muted-foreground"
                >
                  No records for this window{search ? ' and search' : ''}.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="border-b last:border-b-0">
                  <td className="px-4 py-3 font-medium">{r.title}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.subtitle}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {r.date}
                  </td>
                  <td className="px-4 py-3 tabular-nums font-medium">
                    {r.value}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              asChild={page > 1}
              variant="outline"
              size="sm"
              disabled={page <= 1}
            >
              {page > 1 ? <Link href={qs(page - 1)}>Previous</Link> : <span>Previous</span>}
            </Button>
            <Button
              asChild={page < totalPages}
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
            >
              {page < totalPages ? <Link href={qs(page + 1)}>Next</Link> : <span>Next</span>}
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
