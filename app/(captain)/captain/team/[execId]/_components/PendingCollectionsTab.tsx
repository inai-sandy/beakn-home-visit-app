import { formatDistanceToNow } from 'date-fns';
import Link from 'next/link';

import { Icon } from '@/components/ui/icon';
import { formatRupees } from '@/components/today/DayCloseMetricTiles';
import type { ExecPendingCollectionRow } from '@/lib/captain/exec-drill-queries';

interface Props {
  rows: ExecPendingCollectionRow[];
}

export function PendingCollectionsTab({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-8 text-center">
        <Icon
          name="payments"
          size="lg"
          className="text-muted-foreground/60 mx-auto"
        />
        <p className="mt-3 text-sm text-muted-foreground">
          No pending collections. Every quoted order is fully paid.
        </p>
      </div>
    );
  }

  const totalOutstanding = rows.reduce((sum, r) => sum + r.outstandingPaise, 0);

  return (
    <div className="space-y-3">
      <section className="rounded-2xl border bg-card p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Total outstanding
        </p>
        <p className="text-2xl font-semibold tracking-tight tabular-nums truncate">
          {formatRupees(totalOutstanding / 100)}
        </p>
        <p className="text-[11px] text-muted-foreground">
          Across {rows.length} request{rows.length === 1 ? '' : 's'}
        </p>
      </section>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.requestId}>
            <Link
              href={`/requests/${r.requestId}`}
              className="block rounded-2xl border bg-card p-4 hover:bg-muted/40 transition-colors space-y-2"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold tracking-tight min-w-0 truncate">
                  {r.customerName}
                </p>
                <p className="text-sm font-semibold tabular-nums shrink-0">
                  {formatRupees(r.outstandingPaise / 100)}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="min-w-0">
                  <p className="text-muted-foreground truncate">Quoted</p>
                  <p className="font-mono tabular-nums truncate">
                    {formatRupees(r.quotedPaise / 100)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-muted-foreground truncate">Received</p>
                  <p className="font-mono tabular-nums truncate">
                    {formatRupees(r.paidPaise / 100)}
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {r.cityName} · quoted{' '}
                {formatDistanceToNow(r.quotedAt, { addSuffix: true })}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
