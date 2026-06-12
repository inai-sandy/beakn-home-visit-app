import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { cn } from '@/lib/utils';

import { AsOfNowTag } from '@/components/dashboard/AsOfNowTag';
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
  basePath = '/captain',
}: {
  summary: PendingCollectionsSummary;
  filter: DateFilter;
  /** Route prefix for "View details". Defaults to `/captain`; admin
   *  captain-portal view passes `/admin/portal/[captainId]`. */
  basePath?: string;
}) {
  void filter; // accepted for signature alignment; query layer handles mode
  const collectionsHref = `${basePath}/collections`;
  return (
    <section
      aria-label="Pending collections"
      className="rounded-3xl border bg-card p-5 shadow-sm space-y-3"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold tracking-tight inline-flex items-center gap-1 min-w-0 truncate">
          Pending Collections
          <InfoTooltip iconOnly>
            Money still owed: quotation value minus payments received (refunds
            subtracted). Scope is wider than Pending Approvals — it covers
            requests you&apos;ve accepted PLUS unaccepted requests in your
            cities, matching the Finance page. Aging counts days since the
            quotation was submitted, always relative to today.
          </InfoTooltip>
        </h2>
        <span className="inline-flex items-center gap-2 shrink-0">
          <AsOfNowTag />
          <Badge
            variant={summary.outstandingRequestCount > 0 ? 'default' : 'secondary'}
            className="text-xs"
          >
            {summary.outstandingRequestCount}
          </Badge>
        </span>
      </header>

      <p className="text-3xl font-semibold tracking-tight tabular-nums truncate">
        {formatRupees(summary.totalDueRupees)}
      </p>
      <p className="text-[11px] text-muted-foreground">
        Accepted + unaccepted requests in your cities · aged from quotation
        date.
      </p>

      {/* 2026-05-26: stale-alert banner — outstanding requests where the
          quotation was submitted >48h ago. */}
      {summary.staleCount > 0 && (
        <Link
          href={collectionsHref}
          className="flex items-center gap-2 rounded-2xl border border-amber-400/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 hover:bg-amber-100/80 transition-colors"
        >
          <Icon name="warning" size="sm" className="shrink-0" aria-hidden />
          <span className="flex-1">
            <strong>{summary.staleCount}</strong>
            {summary.staleCount === 1 ? ' collection' : ' collections'} waiting{' '}
            <span className="whitespace-nowrap">&gt; 48h</span>.
          </span>
          <Icon name="chevron_right" size="xs" className="shrink-0" />
        </Link>
      )}

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
          href={collectionsHref}
          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
        >
          View details
          <Icon name="arrow_forward" size="xs" />
        </Link>
      </div>
    </section>
  );
}
