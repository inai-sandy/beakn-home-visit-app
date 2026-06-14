import Link from 'next/link';

import { Icon } from '@/components/ui/icon';
import { InfoTooltip } from '@/components/ui/info-tooltip';

import type {
  AdminCounts,
  AdminRevenueSnapshot,
} from '@/lib/admin/dashboard-queries';
import { METRIC_DEFINITIONS } from '@/lib/metrics/registry';

import { AsOfNowTag } from '@/components/dashboard/AsOfNowTag';

import { formatRupees } from './format';

// =============================================================================
// HVA-117 redesign: consolidated revenue + counts panel
// =============================================================================
//
// Was two separate "Revenue" + "Counts" cards in the left column; now a
// single card with two columns (Money / Pipeline) so they share the same
// frame. Each row has a small tone-coloured icon for at-a-glance reading.
// Pending approvals row is a Link → /admin/operations/admin-help (clearly
// signalled as an action item).
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
      <h2 className="text-base sm:text-lg font-semibold tracking-tight mb-4">
        Revenue &amp; pipeline
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5">
        <div className="space-y-3">
          <h3 className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
            Money
          </h3>
          <ul className="space-y-2.5 text-sm">
            <Row
              icon="payments"
              iconTone="text-emerald-600 bg-emerald-500/10"
              label="Collected"
              explainer={METRIC_DEFINITIONS.revenue.explainer}
              value={formatRupees(revenue.collectedPaise)}
            />
            <Row
              icon="hourglass_bottom"
              iconTone="text-amber-600 bg-amber-500/10"
              label="Outstanding"
              asOfNow
              explainer={METRIC_DEFINITIONS.outstanding.explainer}
              value={formatRupees(revenue.pendingOutstandingPaise)}
            />
            <Row
              icon="request_quote"
              iconTone="text-sky-600 bg-sky-500/10"
              label="Open quotation value"
              asOfNow
              explainer="Total face value of every quotation on a non-cancelled request — paid or not. Snapshot, ignores the date filter."
              value={formatRupees(revenue.openQuotationPaise)}
            />
          </ul>
        </div>
        <div className="space-y-3">
          <h3 className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
            Pipeline
          </h3>
          <ul className="space-y-2.5 text-sm">
            <Row
              icon="inbox"
              iconTone="text-sky-600 bg-sky-500/10"
              label="Open requests"
              asOfNow
              explainer="Non-cancelled visit requests that haven't yet been marked Order Executed Successfully. Snapshot — ignores the date filter."
              value={String(counts.openRequests)}
            />
            <Row
              icon="task_alt"
              iconTone="text-emerald-600 bg-emerald-500/10"
              label="Delivered"
              explainer="Distinct requests that transitioned into Order Executed Successfully in the selected dates (IST). This is the fulfilment milestone — different from the Orders tile, which counts Order Confirmed (the booking event). The two will not match, by design."
              value={String(counts.delivered)}
            />
            <Row
              icon="cancel"
              iconTone="text-rose-600 bg-rose-500/10"
              label="Cancelled"
              explainer={METRIC_DEFINITIONS.cancelled_requests.explainer}
              value={String(counts.cancelled)}
            />
            <Row
              icon="rule"
              iconTone="text-violet-600 bg-violet-500/10"
              label={
                <Link
                  href="/admin/operations/admin-help"
                  className="hover:underline underline-offset-2"
                >
                  Pending captain approvals
                </Link>
              }
              asOfNow
              explainer={METRIC_DEFINITIONS.pending_approvals.explainer}
              value={String(counts.pendingCaptainApprovals)}
              emphasise={counts.pendingCaptainApprovals > 0}
            />
          </ul>
        </div>
      </div>
    </section>
  );
}

function Row({
  icon,
  iconTone,
  label,
  explainer,
  value,
  emphasise = false,
  asOfNow = false,
}: {
  icon: string;
  iconTone: string;
  label: React.ReactNode;
  explainer: string;
  value: string;
  emphasise?: boolean;
  /** HVA-279: snapshot rows wear the tag so they're never read as
   *  belonging to the picked window. */
  asOfNow?: boolean;
}) {
  return (
    <li className="flex items-start justify-between gap-3">
      <span className="inline-flex items-start gap-2.5 min-w-0">
        <span
          className={`inline-flex h-7 w-7 items-center justify-center rounded-lg shrink-0 ${iconTone}`}
          aria-hidden
        >
          <Icon name={icon} size="xs" />
        </span>
        <span className="text-muted-foreground inline-flex flex-wrap items-center gap-x-1 gap-y-0.5">
          {label}
          <InfoTooltip iconOnly>{explainer}</InfoTooltip>
          {asOfNow && <AsOfNowTag />}
        </span>
      </span>
      <span
        className={`font-semibold tabular-nums tracking-tight shrink-0 ${
          emphasise ? 'text-amber-700 dark:text-amber-300' : ''
        }`}
      >
        {value}
      </span>
    </li>
  );
}
