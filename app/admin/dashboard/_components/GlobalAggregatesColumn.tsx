import Link from 'next/link';

import { Icon } from '@/components/ui/icon';

import type {
  AdminCounts,
  AdminGlobalMetrics,
  AdminRevenueSnapshot,
} from '@/lib/admin/dashboard-queries';

// HVA-88: left column — global metrics + revenue + counts.

function formatRupees(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

function formatHours(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

interface Props {
  metrics: AdminGlobalMetrics;
  revenue: AdminRevenueSnapshot;
  counts: AdminCounts;
}

export function GlobalAggregatesColumn({ metrics, revenue, counts }: Props) {
  const tiles: Array<{ label: string; value: string }> = [
    { label: 'Visits', value: String(metrics.visitsToday) },
    { label: 'Collected', value: formatRupees(metrics.collectionsTodayPaise) },
    { label: 'Orders', value: String(metrics.completedOrdersToday) },
    { label: 'New requests', value: String(metrics.newRequestsToday) },
    {
      label: 'Conversion',
      value:
        metrics.conversionPct === null ? '—' : `${metrics.conversionPct}%`,
    },
    { label: 'Productive', value: formatHours(metrics.productiveMinutesToday) },
  ];

  return (
    <div className="space-y-4">
      <section
        aria-label="Today's performance"
        className="rounded-3xl border bg-card p-5 shadow-sm space-y-3"
      >
        <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
          Today's performance
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-2xl border bg-background p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t.label}
              </p>
              <p className="text-lg font-semibold tabular-nums tracking-tight">
                {t.value}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section
        aria-label="Revenue"
        className="rounded-3xl border bg-card p-5 shadow-sm space-y-3"
      >
        <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
          Revenue
        </h2>
        <dl className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Received today</dt>
            <dd className="font-semibold tabular-nums">
              {formatRupees(revenue.receivedTodayPaise)}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Outstanding</dt>
            <dd className="font-semibold tabular-nums">
              {formatRupees(revenue.pendingOutstandingPaise)}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Open quotation value</dt>
            <dd className="font-semibold tabular-nums">
              {formatRupees(revenue.openQuotationPaise)}
            </dd>
          </div>
        </dl>
      </section>

      <section
        aria-label="Counts"
        className="rounded-3xl border bg-card p-5 shadow-sm space-y-3"
      >
        <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
          Counts
        </h2>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center justify-between">
            <span className="text-muted-foreground">Open requests</span>
            <span className="font-semibold tabular-nums">
              {counts.openRequests}
            </span>
          </li>
          <li className="flex items-center justify-between">
            <span className="text-muted-foreground">Completed today</span>
            <span className="font-semibold tabular-nums">
              {counts.completedToday}
            </span>
          </li>
          <li className="flex items-center justify-between">
            <span className="text-muted-foreground">Cancelled today</span>
            <span className="font-semibold tabular-nums">
              {counts.cancelledToday}
            </span>
          </li>
          <li className="flex items-center justify-between">
            <span className="text-muted-foreground">
              <Link
                href="/admin/operations/admin-help"
                className="hover:underline"
              >
                Pending captain approvals
              </Link>
            </span>
            <span className="font-semibold tabular-nums">
              {counts.pendingCaptainApprovals}
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}

export { formatRupees as adminFormatRupees };
