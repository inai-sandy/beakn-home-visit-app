import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

import type { FinanceSnapshot as FinanceSnapshotData } from '@/lib/captain/finance-queries';

// =============================================================================
// PR12 2026-05-26: Finance snapshot — 4 hero tiles
// =============================================================================
//
// 2x2 grid on mobile, 1x4 row on desktop. Each tile carries:
//   - eyebrow label
//   - large rupee figure (₹XX,XX,XXX, IST locale)
//   - one-line subline
//   - icon + colour to telegraph intent
//
// Outstanding can render negative ("credit owed") — the formatter
// handles the sign and the tile flips to an amber tone.
// =============================================================================

function formatRupees(paise: number): string {
  const rupees = paise / 100;
  const sign = rupees < 0 ? '-' : '';
  const abs = Math.abs(rupees);
  return `${sign}${new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(abs)}`;
}

interface TileProps {
  label: string;
  amountPaise: number;
  subline: string;
  icon: string;
  /** Tailwind colour family for the tile accent. */
  tone: 'primary' | 'sky' | 'emerald' | 'amber' | 'rose';
  /** Optional override — Outstanding flips this on negative values. */
  negativeIsAmber?: boolean;
}

function Tile({ label, amountPaise, subline, icon, tone, negativeIsAmber }: TileProps) {
  const effectiveTone =
    negativeIsAmber && amountPaise < 0 ? 'amber' : tone;
  const toneCls = {
    primary: 'border-primary/30 bg-primary/5',
    sky: 'border-sky-300/40 bg-sky-50/60 dark:bg-sky-950/20',
    emerald: 'border-emerald-300/40 bg-emerald-50/60 dark:bg-emerald-950/20',
    amber: 'border-amber-300/50 bg-amber-50/70 dark:bg-amber-950/20',
    rose: 'border-rose-300/40 bg-rose-50/60 dark:bg-rose-950/20',
  }[effectiveTone];
  const iconCls = {
    primary: 'text-primary',
    sky: 'text-sky-600',
    emerald: 'text-emerald-600',
    amber: 'text-amber-700',
    rose: 'text-rose-600',
  }[effectiveTone];

  return (
    <div
      className={cn(
        'rounded-3xl border p-4 sm:p-5 shadow-sm space-y-1.5',
        toneCls,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <Icon name={icon} size="sm" className={cn('shrink-0', iconCls)} />
      </div>
      <p className="text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums">
        {formatRupees(amountPaise)}
      </p>
      <p className="text-[11px] text-muted-foreground">{subline}</p>
    </div>
  );
}

interface Props {
  snapshot: FinanceSnapshotData;
}

export function FinanceSnapshot({ snapshot }: Props) {
  const { orderBook, pipeline, receivedPaise, totalQuotedPaise, outstandingPaise } =
    snapshot;

  const collectionPct =
    totalQuotedPaise > 0
      ? Math.round((receivedPaise / totalQuotedPaise) * 100)
      : 0;
  const totalQuoteCount = orderBook.count + pipeline.count;

  return (
    <section
      aria-label="Money snapshot"
      className="grid grid-cols-2 lg:grid-cols-4 gap-3"
    >
      <Tile
        label="Order Book"
        amountPaise={orderBook.totalPaise}
        subline={`${orderBook.count} confirmed order${orderBook.count === 1 ? '' : 's'}`}
        icon="receipt_long"
        tone="primary"
      />
      <Tile
        label="Quotation Pipeline"
        amountPaise={pipeline.totalPaise}
        subline={`${pipeline.count} quote${pipeline.count === 1 ? '' : 's'} awaiting confirm`}
        icon="description"
        tone="sky"
      />
      <Tile
        label="Received"
        amountPaise={receivedPaise}
        subline={
          totalQuotedPaise > 0
            ? `${collectionPct}% of total quoted collected`
            : 'No quotations yet'
        }
        icon="account_balance_wallet"
        tone="emerald"
      />
      <Tile
        label="Outstanding"
        amountPaise={outstandingPaise}
        subline={
          outstandingPaise < 0
            ? 'Credit owed to customer'
            : outstandingPaise === 0
              ? 'Fully collected'
              : `Across ${totalQuoteCount} quote${totalQuoteCount === 1 ? '' : 's'}`
        }
        icon={outstandingPaise < 0 ? 'sync_alt' : 'hourglass_top'}
        tone="rose"
        negativeIsAmber
      />
    </section>
  );
}
