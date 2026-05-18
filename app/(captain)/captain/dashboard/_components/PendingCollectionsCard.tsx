import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

import type { PendingCollectionsSummary } from '@/lib/captain/dashboard-queries';

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
}: {
  label: string;
  amount: number;
  tone: 'green' | 'amber' | 'red';
}) {
  const dotCls =
    tone === 'green' ? 'bg-green-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span aria-hidden className={cn('inline-block h-2 w-2 rounded-full', dotCls)} />
        <span className="text-muted-foreground">{label}</span>
      </div>
      <span className="text-sm font-mono">{formatRupees(amount)}</span>
    </div>
  );
}

export function PendingCollectionsCard({
  summary,
}: {
  summary: PendingCollectionsSummary;
}) {
  return (
    <section
      aria-label="Pending collections"
      className="rounded-3xl border bg-card p-5 shadow-sm space-y-3"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight">
          Pending Collections
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
        <BucketRow label="0–7 days" amount={summary.buckets.zeroToSeven} tone="green" />
        <BucketRow label="8–30 days" amount={summary.buckets.eightToThirty} tone="amber" />
        <BucketRow label="30+ days" amount={summary.buckets.thirtyPlus} tone="red" />
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
