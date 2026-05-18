import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { cn } from '@/lib/utils';

import type {
  DateFilter,
  PendingCollectionsSummary,
} from '@/lib/captain/dashboard-queries';

// =============================================================================
// HVA-80: Pending Collections card — total ₹ + 3 aging buckets
// =============================================================================
//
// Schema gap (documented in lib/captain/dashboard-queries.ts):
// `payments` has no due-date column. Aging is proxied by
// `quotation.submittedAt` — days since the customer received the quote
// without paying in full. The buckets are operationally meaningful even
// if they don't match a strict "billing due date" interpretation.
//
// "View details" → /captain/collections (HVA-78 stub today; the link
// works but lands on a "Coming soon" placeholder. Full screen is a
// separate future ticket).
// =============================================================================

function formatRupees(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

function BucketRow({
  label,
  amount,
  tone,
  tooltip,
}: {
  label: string;
  amount: number;
  tone: 'green' | 'amber' | 'red';
  tooltip: string;
}) {
  const dotCls =
    tone === 'green' ? 'bg-green-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span aria-hidden className={cn('inline-block h-2 w-2 rounded-full', dotCls)} />
        <span className="text-muted-foreground inline-flex items-center gap-1">
          {label}
          <InfoTooltip iconOnly>{tooltip}</InfoTooltip>
        </span>
      </div>
      <span className="text-sm font-mono">{formatRupees(amount)}</span>
    </div>
  );
}

export function PendingCollectionsCard({
  summary,
  filter,
}: {
  summary: PendingCollectionsSummary;
  filter: DateFilter;
}) {
  void filter; // accepted for signature alignment; query layer handles mode
  return (
    <section
      aria-label="Pending collections"
      className="rounded-3xl border bg-card p-5 shadow-sm space-y-3"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight inline-flex items-center gap-1">
          Pending Collections
          <InfoTooltip iconOnly>
            Total amount owed by customers where a quotation has been submitted
            and inbound payments don&apos;t cover the full quoted value. Aging
            buckets are always relative to today and show how long the
            quotation has been outstanding.
          </InfoTooltip>
        </h2>
        <Badge
          variant={summary.outstandingRequestCount > 0 ? 'default' : 'secondary'}
          className="text-xs"
        >
          {summary.outstandingRequestCount}
        </Badge>
      </header>

      <p className="text-3xl font-semibold tracking-tight">
        {formatRupees(summary.totalDueRupees)}
      </p>
      <p className="text-[11px] text-muted-foreground">
        Days since quotation submitted (proxy for billing date).
      </p>

      <div className="divide-y rounded-2xl border bg-muted/20 px-3">
        <BucketRow
          label="0–7 days"
          amount={summary.buckets.zeroToSeven}
          tone="green"
          tooltip="Customers who received a quotation in the past 7 days with payment still outstanding."
        />
        <BucketRow
          label="8–30 days"
          amount={summary.buckets.eightToThirty}
          tone="amber"
          tooltip="Customers who received a quotation 8–30 days ago with payment still outstanding. Follow-up recommended."
        />
        <BucketRow
          label="30+ days"
          amount={summary.buckets.thirtyPlus}
          tone="red"
          tooltip="Customers with quotations 31+ days old still unpaid. Escalation may be needed."
        />
      </div>

      <div className="flex justify-end">
        <Link
          href="/captain/collections"
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          View details
          <Icon name="arrow_forward" size="xs" />
        </Link>
      </div>
    </section>
  );
}
