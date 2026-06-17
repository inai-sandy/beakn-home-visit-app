import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { getServerSession } from '@/lib/auth-server';
import { loadMetrics } from '@/lib/metrics/registry';
import {
  loadFinanceAgingBuckets,
  loadFinanceSnapshot,
} from '@/lib/captain/finance-queries';
import {
  loadAdminPaymentsLedger,
  loadAdminPaymentTotals,
  type LedgerDirection,
} from '@/lib/admin/finance-ledger';
import { getCurrentMonthWindow } from '@/lib/exec/target-progress';
import { financialYearToDate } from '@/lib/date';
import { getIstDateString } from '@/lib/today/time';
import { formatInrFromPaise } from '@/lib/money';
import { parsePage } from '@/lib/pagination';

import { DashboardTabNav } from '@/components/dashboard/DashboardTabNav';
import { FinanceSnapshot } from '@/app/(captain)/captain/collections/_components/FinanceSnapshot';
import { FinanceAgingBuckets } from '@/app/(captain)/captain/collections/_components/FinanceAgingBuckets';

// =============================================================================
// HVA-297: /admin/finance — org-wide finance dashboard
// =============================================================================
//
// Three tabs (Today / This month / Overall = FY-to-date) drive the FLOW
// figures (collected / refunds / booked) + the payments ledger. POSITION
// figures (outstanding / order book / pipeline / credits) are as-of-now
// (FinanceSnapshot, super-admin scope) and ignore the tab. Every tile is
// clickable; the ledger lists every non-voided payment with search +
// pagination. Reuses the captain finance components at isSuperAdmin scope.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Finance — Beakn admin' };

const PAGE_SIZE = 20;

const TABS = [
  { value: 'today', label: 'Today' },
  { value: 'month', label: 'This month' },
  { value: 'overall', label: 'Overall' },
];

function rangeForView(view: string, istToday: string): {
  fromDate: string;
  toDate: string;
  label: string;
} {
  if (view === 'month') {
    const m = getCurrentMonthWindow();
    return { fromDate: m.monthStart, toDate: istToday, label: `${m.monthLabel} · to date` };
  }
  if (view === 'overall') {
    const fy = financialYearToDate(istToday);
    return { fromDate: fy.fromDate, toDate: fy.toDate, label: 'Financial year · to date' };
  }
  return { fromDate: istToday, toDate: istToday, label: 'Today' };
}

interface PageProps {
  searchParams: Promise<{
    view?: string;
    q?: string;
    page?: string;
    dir?: string;
  }>;
}

export default async function AdminFinancePage({ searchParams }: PageProps) {
  const session = await getServerSession();
  if (!session) redirect('/login?next=/admin/finance');
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') redirect('/login');

  const sp = await searchParams;
  const view = sp.view === 'month' || sp.view === 'overall' ? sp.view : 'today';
  const istToday = getIstDateString();
  const { fromDate, toDate, label: rangeLabel } = rangeForView(view, istToday);
  const search = (sp.q ?? '').trim();
  const page = parsePage(sp.page);
  const dir: LedgerDirection | undefined =
    sp.dir === 'inbound' || sp.dir === 'outbound' ? sp.dir : undefined;

  const scope = { captainUserId: user.id, isSuperAdmin: true } as const;
  const range = { fromDate, toDate };

  const [metrics, totals, snapshot, aging, ledger] = await Promise.all([
    loadMetrics(['revenue', 'orders_value', 'orders_count'] as const, {}, range),
    loadAdminPaymentTotals({ fromDate, toDate }),
    loadFinanceSnapshot({ ...scope }),
    loadFinanceAgingBuckets({ ...scope }),
    loadAdminPaymentsLedger({
      fromDate,
      toDate,
      search,
      page,
      pageSize: PAGE_SIZE,
      direction: dir,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(ledger.total / PAGE_SIZE));

  // Flow tiles — windowed. Cash tiles deep-link to the ledger (filtered);
  // booked/orders reuse the KPI drill-downs.
  const winQs = `from=${fromDate}&to=${toDate}`;
  const flowTiles = [
    {
      label: 'Collected (net)',
      icon: 'payments',
      tone: 'text-emerald-600 bg-emerald-500/10',
      value: formatInrFromPaise(metrics.revenue ?? 0),
      href: `?view=${view}#ledger`,
    },
    {
      label: 'Gross received',
      icon: 'south_west',
      tone: 'text-emerald-600 bg-emerald-500/10',
      value: formatInrFromPaise(totals.grossInboundPaise),
      href: `?view=${view}&dir=inbound#ledger`,
    },
    {
      label: 'Refunds',
      icon: 'north_east',
      tone: 'text-rose-600 bg-rose-500/10',
      value: formatInrFromPaise(totals.refundsPaise),
      href: `?view=${view}&dir=outbound#ledger`,
    },
    {
      label: 'Booked',
      icon: 'sell',
      tone: 'text-teal-600 bg-teal-500/10',
      value: formatInrFromPaise(metrics.orders_value ?? 0),
      href: `/admin/dashboard/booked?${winQs}`,
    },
    {
      label: 'Orders',
      icon: 'shopping_bag',
      tone: 'text-sky-600 bg-sky-500/10',
      value: String(metrics.orders_count ?? 0),
      href: `/admin/dashboard/orders?${winQs}`,
    },
  ];

  const qs = (p: number) => {
    const params = new URLSearchParams();
    params.set('view', view);
    if (dir) params.set('dir', dir);
    if (search) params.set('q', search);
    if (p > 1) params.set('page', String(p));
    return `?${params.toString()}#ledger`;
  };

  return (
    <main className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="flex flex-col items-center gap-2">
        <DashboardTabNav tabs={TABS} active={view} />
        <p className="text-xs text-muted-foreground">{rangeLabel}</p>
      </div>

      {/* Flow tiles — windowed */}
      <section aria-label="Money flow" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {flowTiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className="rounded-2xl border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:bg-accent/30 min-w-0"
          >
            <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${t.tone}`} aria-hidden>
              <Icon name={t.icon} size="sm" />
            </span>
            <p className="mt-3 truncate text-lg font-semibold tracking-tight tabular-nums">
              {t.value}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t.label}</p>
          </Link>
        ))}
      </section>

      {/* Position — as-of-now snapshot (reused at admin scope) */}
      <section aria-label="Position" className="space-y-3">
        <h2 className="text-sm font-semibold tracking-tight text-muted-foreground">
          Position · as of today
        </h2>
        <FinanceSnapshot snapshot={snapshot} basePath="/admin/finance" />
      </section>

      <FinanceAgingBuckets buckets={aging} />

      {/* The ledger — every payment */}
      <section id="ledger" aria-label="Payments ledger" className="scroll-mt-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight">
            Payments ledger
            <span className="ml-2 font-normal text-muted-foreground">
              {ledger.total.toLocaleString('en-IN')} record{ledger.total === 1 ? '' : 's'}
              {dir ? ` · ${dir === 'inbound' ? 'received' : 'refunds'}` : ''}
              {' · '}{rangeLabel}
            </span>
          </h2>
          <form method="GET" className="flex gap-2">
            <input type="hidden" name="view" value={view} />
            {dir && <input type="hidden" name="dir" value={dir} />}
            <Input type="search" name="q" defaultValue={search} placeholder="Customer / phone / ref…" className="h-9 max-w-[200px]" />
            <Button type="submit" variant="outline" size="sm">
              <Icon name="search" size="xs" />
            </Button>
            {dir && (
              <Button asChild variant="ghost" size="sm">
                <Link href={`?view=${view}#ledger`}>All</Link>
              </Button>
            )}
          </form>
        </div>

        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">Customer</th>
                <th className="px-4 py-2.5 font-medium">City</th>
                <th className="px-4 py-2.5 font-medium">Mode</th>
                <th className="px-4 py-2.5 font-medium">Recorded by</th>
                <th className="px-4 py-2.5 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {ledger.rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    No payments for this window{search ? ' and search' : ''}.
                  </td>
                </tr>
              ) : (
                ledger.rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-b-0">
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">{r.paymentDate}</td>
                    <td className="px-4 py-3 font-medium">
                      <Link href={`/requests/${r.requestId}`} className="hover:underline">
                        {r.customerName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.cityName ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.mode}</td>
                    <td className="px-4 py-3 text-muted-foreground">{r.recordedByName ?? '—'}</td>
                    <td
                      className={
                        'px-4 py-3 text-right font-medium tabular-nums ' +
                        (r.direction === 'outbound' ? 'text-rose-600' : 'text-emerald-700 dark:text-emerald-300')
                      }
                    >
                      {r.direction === 'outbound' ? '− ' : ''}
                      {formatInrFromPaise(r.amountPaise)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <Button asChild={page > 1} variant="outline" size="sm" disabled={page <= 1}>
                {page > 1 ? <Link href={qs(page - 1)}>Previous</Link> : <span>Previous</span>}
              </Button>
              <Button asChild={page < totalPages} variant="outline" size="sm" disabled={page >= totalPages}>
                {page < totalPages ? <Link href={qs(page + 1)}>Next</Link> : <span>Next</span>}
              </Button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
