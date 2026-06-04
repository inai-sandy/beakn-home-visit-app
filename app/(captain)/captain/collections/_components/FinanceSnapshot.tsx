import Link from 'next/link';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

import type { FinanceSnapshot as FinanceSnapshotData } from '@/lib/captain/finance-queries';

// =============================================================================
// PR12 2026-05-26: Finance snapshot — 4 hero tiles
// 2026-06-03 Sandeep: tiles are now Links → /collections/<tile-slug>
// dedicated detail pages with full tables.
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

type Tone = 'primary' | 'sky' | 'emerald' | 'amber' | 'rose';

interface TileProps {
  label: string;
  amountPaise: number;
  subline: string;
  icon: string;
  tone: Tone;
  href: string;
  /** Outstanding flips tone to amber on negative values (credit owed). */
  negativeIsAmber?: boolean;
}

function Tile({
  label,
  amountPaise,
  subline,
  icon,
  tone,
  href,
  negativeIsAmber,
}: TileProps) {
  const effectiveTone: Tone =
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
    <Link
      href={href}
      className={cn(
        'rounded-3xl border p-4 sm:p-5 shadow-sm space-y-1.5',
        'transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        toneCls,
      )}
      aria-label={`Open ${label} detail`}
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
      <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
        {subline}
        <Icon
          name="arrow_forward"
          size="xs"
          className="text-muted-foreground/60"
        />
      </p>
    </Link>
  );
}

interface Props {
  snapshot: FinanceSnapshotData;
  /** Where each tile links. The base is the Finance page itself
   *  (e.g. `/captain/collections`) — this component appends
   *  `/<tile-slug>` for the destination. */
  basePath: string;
}

export function FinanceSnapshot({ snapshot, basePath }: Props) {
  const {
    orderBook,
    pipeline,
    receivedPaise,
    totalQuotedPaise,
    outstandingPaise,
    creditsOwedPaise,
    outstandingCount,
    creditsOwedCount,
  } = snapshot;

  const collectionPct =
    totalQuotedPaise > 0
      ? Math.round((receivedPaise / totalQuotedPaise) * 100)
      : 0;

  const hasCredits = creditsOwedPaise > 0;

  return (
    <section
      aria-label="Money snapshot"
      className={cn(
        'grid grid-cols-2 gap-3',
        hasCredits ? 'lg:grid-cols-5' : 'lg:grid-cols-4',
      )}
    >
      <Tile
        label="Order Book"
        amountPaise={orderBook.totalPaise}
        subline={`${orderBook.count} confirmed order${orderBook.count === 1 ? '' : 's'}`}
        icon="receipt_long"
        tone="primary"
        href={`${basePath}/order-book`}
      />
      <Tile
        label="Quotation Pipeline"
        amountPaise={pipeline.totalPaise}
        subline={`${pipeline.count} quote${pipeline.count === 1 ? '' : 's'} awaiting confirm`}
        icon="description"
        tone="sky"
        href={`${basePath}/pipeline`}
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
        href={`${basePath}/received`}
      />
      <Tile
        label="Outstanding"
        amountPaise={outstandingPaise}
        subline={
          outstandingCount === 0
            ? 'Fully collected'
            : `Across ${outstandingCount} customer${outstandingCount === 1 ? '' : 's'}`
        }
        icon="hourglass_top"
        tone="rose"
        href={`${basePath}/outstanding`}
      />
      {hasCredits && (
        <Tile
          label="Credits owed"
          amountPaise={creditsOwedPaise}
          subline={`Refund liability across ${creditsOwedCount} customer${creditsOwedCount === 1 ? '' : 's'}`}
          icon="sync_alt"
          tone="amber"
          href={`${basePath}/credits-owed`}
        />
      )}
    </section>
  );
}
