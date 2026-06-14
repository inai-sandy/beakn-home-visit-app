import Link from 'next/link';

import { Icon } from '@/components/ui/icon';
import { InfoTooltip } from '@/components/ui/info-tooltip';
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
  /** HVA-290: plain-English explainer rendered by the ⓘ button. */
  explainer: string;
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
  explainer,
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

  // HVA-290: the ⓘ button can't nest inside the <Link> (button-in-anchor),
  // so it sits as an absolutely-positioned sibling above the tile.
  return (
    <div className="relative">
      <Link
        href={href}
        className={cn(
          'block rounded-3xl border p-4 shadow-sm space-y-1',
          'transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          toneCls,
        )}
        aria-label={`Open ${label} detail`}
      >
        <div className="flex items-center justify-between gap-2 pr-6">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <Icon name={icon} size="sm" className={cn('shrink-0', iconCls)} />
        </div>
        <p className="text-xl font-semibold tracking-tight tabular-nums">
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
      <div className="absolute right-2.5 top-2.5">
        <InfoTooltip iconOnly>{explainer}</InfoTooltip>
      </div>
    </div>
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
        explainer="Total quotation value of all confirmed orders (reached Order Confirmed and not cancelled). This is the booked business, not cash received."
      />
      <Tile
        label="Quotation Pipeline"
        amountPaise={pipeline.totalPaise}
        subline={`${pipeline.count} quote${pipeline.count === 1 ? '' : 's'} awaiting confirm`}
        icon="description"
        tone="sky"
        href={`${basePath}/pipeline`}
        explainer="Quotation value of requests that have a quotation but haven't been confirmed yet (still at Quotation Given). Potential business awaiting the customer's go-ahead."
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
        explainer="Net cash actually collected: inbound payments minus refunds (voided payments excluded). The percentage is received ÷ total quoted value."
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
        explainer="Money still owed: for each non-cancelled order, quotation total minus net payments, summed where positive. As of now — not bounded by any date range."
      />
      {hasCredits && (
        <Tile
          label="Credits owed"
          amountPaise={creditsOwedPaise}
          subline={`Refund liability across ${creditsOwedCount} customer${creditsOwedCount === 1 ? '' : 's'}`}
          icon="sync_alt"
          tone="amber"
          href={`${basePath}/credits-owed`}
          explainer="Refund liability: where a customer has paid more than their order total (e.g. after a downward revision), summed across customers. Money we owe back."
        />
      )}
    </section>
  );
}
