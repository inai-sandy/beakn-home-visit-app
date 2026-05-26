import { cn } from '@/lib/utils';

import type { FinanceAgingBucket } from '@/lib/captain/finance-queries';

// =============================================================================
// PR12 2026-05-26: Aging buckets bar chart
// =============================================================================
//
// Horizontal progress-bar layout — each bucket is a coloured bar whose
// width is proportional to its share of total outstanding. Counts +
// ₹ totals next to each bar. Mobile-friendly because it stacks
// vertically already; the bar fill ratio gives an at-a-glance picture
// without needing a chart library.
// =============================================================================

function formatRupees(paise: number): string {
  const rupees = paise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(rupees);
}

interface Props {
  buckets: FinanceAgingBucket[];
}

const TONE_CLS: Record<FinanceAgingBucket['key'], { bar: string; dot: string; label: string }> = {
  zeroToSeven: {
    bar: 'bg-emerald-500/70',
    dot: 'bg-emerald-500',
    label: 'text-emerald-700 dark:text-emerald-400',
  },
  eightToThirty: {
    bar: 'bg-amber-500/70',
    dot: 'bg-amber-500',
    label: 'text-amber-700 dark:text-amber-400',
  },
  thirtyPlus: {
    bar: 'bg-rose-500/70',
    dot: 'bg-rose-500',
    label: 'text-rose-700 dark:text-rose-400',
  },
};

export function FinanceAgingBuckets({ buckets }: Props) {
  const max = Math.max(1, ...buckets.map((b) => b.outstandingPaise));
  const grandTotal = buckets.reduce((acc, b) => acc + b.outstandingPaise, 0);

  return (
    <section
      aria-label="Outstanding aging buckets"
      className="rounded-3xl border bg-card p-5 shadow-sm space-y-3"
    >
      <header className="flex items-baseline justify-between gap-2 flex-wrap">
        <h2 className="text-base font-semibold tracking-tight">
          Outstanding by age
        </h2>
        <p className="text-[11px] text-muted-foreground">
          Order Book only · {formatRupees(grandTotal)} total
        </p>
      </header>

      {grandTotal === 0 ? (
        <p className="text-xs text-muted-foreground italic py-2">
          Nothing outstanding — all confirmed orders are fully paid.
        </p>
      ) : (
        <ul className="space-y-3">
          {buckets.map((b) => {
            const widthPct =
              b.outstandingPaise === 0
                ? 0
                : Math.max(4, Math.round((b.outstandingPaise / max) * 100));
            const tone = TONE_CLS[b.key];
            return (
              <li key={b.key} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className={cn('inline-flex items-center gap-2 font-medium', tone.label)}>
                    <span aria-hidden className={cn('inline-block h-2 w-2 rounded-full', tone.dot)} />
                    {b.label}
                  </span>
                  <span className="tabular-nums">
                    {formatRupees(b.outstandingPaise)}
                    <span className="text-muted-foreground ml-1.5">
                      · {b.count} order{b.count === 1 ? '' : 's'}
                    </span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', tone.bar)}
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
