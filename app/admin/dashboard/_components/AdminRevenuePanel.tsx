import Link from 'next/link';

import { Icon } from '@/components/ui/icon';
import { InfoTooltip } from '@/components/ui/info-tooltip';

import type {
  AdminCounts,
  AdminRevenueSnapshot,
} from '@/lib/admin/dashboard-queries';
import { METRIC_DEFINITIONS } from '@/lib/metrics/registry';
import { cn } from '@/lib/utils';

import { AsOfNowTag } from '@/components/dashboard/AsOfNowTag';

import { formatRupees } from './format';

// =============================================================================
// HVA-292: Revenue & pipeline — grouped stat-tile grid
// =============================================================================
//
// Was a half-width two-column list that truncated; then a full-width list
// that read sparse. Now a full-width card with two labelled groups
// (Money / Pipeline), each a responsive grid of compact stat tiles so the
// width is used and every figure has room. Each tile carries its ⓘ
// explainer; snapshot tiles wear the "as of now" tag.
// =============================================================================

interface Props {
  revenue: AdminRevenueSnapshot;
  counts: AdminCounts;
}

export function AdminRevenuePanel({ revenue, counts }: Props) {
  return (
    <section
      aria-label="Revenue & pipeline"
      className="rounded-3xl border bg-card p-5 sm:p-6 shadow-sm"
    >
      <h2 className="mb-5 text-base sm:text-lg font-semibold tracking-tight">
        Revenue &amp; pipeline
      </h2>

      <div className="space-y-6">
        <Group label="Money" cols="sm:grid-cols-3">
          <StatTile
            icon="payments"
            tone="text-emerald-600 bg-emerald-500/10"
            label="Collected"
            value={formatRupees(revenue.collectedPaise)}
            explainer={METRIC_DEFINITIONS.revenue.explainer}
          />
          <StatTile
            icon="hourglass_bottom"
            tone="text-amber-600 bg-amber-500/10"
            label="Outstanding"
            asOfNow
            value={formatRupees(revenue.pendingOutstandingPaise)}
            explainer={METRIC_DEFINITIONS.outstanding.explainer}
          />
          <StatTile
            icon="request_quote"
            tone="text-sky-600 bg-sky-500/10"
            label="Open quotation value"
            asOfNow
            value={formatRupees(revenue.openQuotationPaise)}
            explainer="Total face value of every quotation on a non-cancelled request — paid or not. Snapshot, ignores the date filter."
          />
        </Group>

        <Group label="Pipeline" cols="sm:grid-cols-4">
          <StatTile
            icon="inbox"
            tone="text-sky-600 bg-sky-500/10"
            label="Open requests"
            asOfNow
            value={String(counts.openRequests)}
            explainer="Non-cancelled visit requests that haven't yet been marked Order Executed Successfully. Snapshot — ignores the date filter."
          />
          <StatTile
            icon="task_alt"
            tone="text-emerald-600 bg-emerald-500/10"
            label="Delivered"
            value={String(counts.delivered)}
            explainer="Distinct requests that transitioned into Order Executed Successfully in the selected dates (IST). This is the fulfilment milestone — different from the Orders tile, which counts Order Confirmed (the booking event). The two will not match, by design."
          />
          <StatTile
            icon="cancel"
            tone="text-rose-600 bg-rose-500/10"
            label="Cancelled"
            value={String(counts.cancelled)}
            explainer={METRIC_DEFINITIONS.cancelled_requests.explainer}
          />
          <StatTile
            icon="rule"
            tone="text-violet-600 bg-violet-500/10"
            label="Pending captain approvals"
            href="/admin/operations/admin-help"
            asOfNow
            emphasise={counts.pendingCaptainApprovals > 0}
            value={String(counts.pendingCaptainApprovals)}
            explainer={METRIC_DEFINITIONS.pending_approvals.explainer}
          />
        </Group>
      </div>
    </section>
  );
}

function Group({
  label,
  cols,
  children,
}: {
  label: string;
  cols: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2.5">
      <h3 className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
        {label}
      </h3>
      <div className={cn('grid grid-cols-2 gap-3', cols)}>{children}</div>
    </div>
  );
}

function StatTile({
  icon,
  tone,
  label,
  value,
  explainer,
  href,
  asOfNow = false,
  emphasise = false,
}: {
  icon: string;
  tone: string;
  label: string;
  value: string;
  explainer: string;
  href?: string;
  asOfNow?: boolean;
  emphasise?: boolean;
}) {
  return (
    <div className="rounded-2xl border bg-background/50 p-3.5 min-w-0">
      <div className="flex items-start justify-between gap-1.5">
        <span
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-lg shrink-0',
            tone,
          )}
          aria-hidden
        >
          <Icon name={icon} size="xs" />
        </span>
        <InfoTooltip iconOnly>{explainer}</InfoTooltip>
      </div>

      <p
        className={cn(
          'mt-2.5 text-lg font-semibold tabular-nums tracking-tight truncate',
          emphasise && 'text-amber-700 dark:text-amber-300',
        )}
      >
        {value}
      </p>

      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {href ? (
          <Link
            href={href}
            className="text-xs text-muted-foreground leading-snug hover:text-foreground hover:underline underline-offset-2"
          >
            {label}
          </Link>
        ) : (
          <span className="text-xs text-muted-foreground leading-snug">
            {label}
          </span>
        )}
        {asOfNow && <AsOfNowTag />}
      </div>
    </div>
  );
}
