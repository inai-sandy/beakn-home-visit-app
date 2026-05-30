'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import {
  DayCloseMetricTiles,
  formatRupees,
} from '@/components/today/DayCloseMetricTiles';

import type { DayCloseMetrics } from '@/lib/today/metrics';
import { computeDayVerdict, type VerdictKind } from '@/lib/today/verdict';

import { closeDayAction } from '../../actions';

const VERDICT_RING_CLASS: Record<VerdictKind, string> = {
  green: 'bg-emerald-100 text-emerald-700 ring-2 ring-emerald-500/40',
  yellow: 'bg-amber-100 text-amber-700 ring-2 ring-amber-500/40',
  red: 'bg-rose-100 text-rose-700 ring-2 ring-rose-500/40',
};

const VERDICT_ICON: Record<VerdictKind, string> = {
  green: 'sentiment_very_satisfied',
  yellow: 'sentiment_neutral',
  red: 'sentiment_dissatisfied',
};

function formatMinutes(mins: number): string {
  if (mins <= 0) return '0m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// =============================================================================
// HVA-64: Close the Day client wrapper
// =============================================================================
//
// Renders the metric tree + the close confirmation flow. The server
// computed every value; this component is purely presentational +
// dispatches the closeDayAction.
//
// Sections (per locked decision G):
//   1. Sticky-ish header with day-summary headline
//   2. 6-metric grid (traffic-light per cell)
//   3. Plan vs Actual variance card
//   4. Amount collected card
//   5. Quotations submitted card
//   6. AI Daily Report Card placeholder ("Available in Phase 3")
//   7. Close the Day CTA (hidden when closedAt is set)
// =============================================================================

interface Props {
  dayPlan: { id: string; closedAt: string | null };
  metrics: DayCloseMetrics;
}

export function CloseDayView({ dayPlan, metrics }: Props) {
  const router = useRouter();
  const closed = dayPlan.closedAt !== null;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // eslint-disable-next-line no-restricted-syntax -- HVA-149: predates useServerMutation; HVA-149-cleanup TODO
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  async function onConfirmClose() {
    if (busy) return;
    setSubmitting(true);
    try {
      const result = await closeDayAction({
        amountCollectedPaise: metrics.amountCollectedPaise,
        quotationsSubmittedToday: metrics.quotationsCount,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Day closed.');
      setConfirmOpen(false);
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setSubmitting(false);
    }
  }

  const { taskCounts, amountCollectedPaise, inboundPaymentCount, quotationsCount } =
    metrics;
  const rupees = amountCollectedPaise / 100;
  // HVA-64 sticky-header verdict — derived from target metrics. Pure helper;
  // safe to call on every render since the inputs are server-fetched and
  // memo-equivalent for the lifetime of this component.
  const verdict = computeDayVerdict(metrics);

  return (
    <main className="min-h-svh bg-background pb-32">
      {/* HVA-64 sticky verdict header — stays visible while the user scrolls
          through the breakdown below so the "headline" + traffic-light stay
          in view as context. */}
      <header
        className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur"
        aria-label="Day verdict"
      >
        <div className="mx-auto max-w-2xl px-4 sm:px-6 py-4 flex items-center gap-4">
          <div
            className={`h-20 w-20 sm:h-24 sm:w-24 rounded-full flex items-center justify-center shrink-0 ${VERDICT_RING_CLASS[verdict.kind]}`}
            aria-label={`Verdict: ${verdict.kind}`}
          >
            <Icon name={VERDICT_ICON[verdict.kind]} size="lg" />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {closed ? 'Day closed' : 'Close the Day'}
            </p>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight truncate">
              {verdict.headline}
            </h1>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {verdict.oneLiner}
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-6">
        {closed && (
          <p className="text-center text-sm text-muted-foreground">
            Day already closed. This is a read-only summary.
          </p>
        )}

        {/* 6-metric grid (HVA-167 — extracted to a shared component;
            render output is byte-identical for the single-day mode). */}
        <DayCloseMetricTiles metrics={metrics} mode="single" />

        {/* Plan vs Actual — HVA-63 surface for variance + time tracking. */}
        <section
          aria-label="Plan vs Actual"
          className="rounded-2xl border bg-card p-5 space-y-3"
        >
          <header className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Plan vs Actual</h2>
            {metrics.variancePct !== null && (
              <span className="text-sm font-semibold tabular-nums">
                {metrics.variancePct}%{' '}
                <span className="text-xs font-normal text-muted-foreground">
                  of plan
                </span>
              </span>
            )}
          </header>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground truncate">Done</dt>
              <dd className="text-lg font-semibold tabular-nums truncate">
                {taskCounts.done}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground truncate">Postponed</dt>
              <dd className="text-lg font-semibold tabular-nums truncate">
                {taskCounts.postponed}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground truncate">Pending</dt>
              <dd className="text-lg font-semibold tabular-nums truncate">
                {taskCounts.pending}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground truncate">
                Added during day
              </dt>
              <dd className="text-lg font-semibold tabular-nums truncate">
                {taskCounts.addedDuringDay}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground truncate">
                Estimated time
              </dt>
              <dd className="text-lg font-semibold tabular-nums truncate">
                {formatMinutes(metrics.estimatedTotalMinutes)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground truncate">
                Actual time
              </dt>
              <dd className="text-lg font-semibold tabular-nums truncate">
                {formatMinutes(metrics.actualTotalMinutes)}
              </dd>
            </div>
            {taskCounts.fastCompletionCount > 0 && (
              <div className="col-span-2">
                <Badge variant="destructive" className="text-[10px]">
                  ⚡ {taskCounts.fastCompletionCount} fast-completion flag
                  {taskCounts.fastCompletionCount === 1 ? '' : 's'}
                </Badge>
              </div>
            )}
          </dl>
        </section>

        {/* Amount collected */}
        <section
          aria-label="Amount collected today"
          className="rounded-2xl border bg-card p-5 space-y-1"
        >
          <h2 className="text-sm font-semibold">Amount collected today</h2>
          <p className="text-2xl font-semibold tracking-tight">
            {formatRupees(rupees)}
          </p>
          <p className="text-xs text-muted-foreground">
            From {inboundPaymentCount} inbound payment
            {inboundPaymentCount === 1 ? '' : 's'}.
          </p>
        </section>

        {/* Quotations submitted */}
        <section
          aria-label="Quotations submitted today"
          className="rounded-2xl border bg-card p-5 space-y-1"
        >
          <h2 className="text-sm font-semibold">Quotations submitted today</h2>
          <p className="text-2xl font-semibold tracking-tight">{quotationsCount}</p>
        </section>

        {/* AI Daily Report Card — Phase 3 placeholder */}
        <section
          aria-label="AI Daily Report Card"
          className="rounded-2xl border border-dashed bg-muted/30 p-5 space-y-1"
        >
          <h2 className="text-sm font-semibold">AI Daily Report Card</h2>
          <p className="text-xs text-muted-foreground">Available in Phase 3.</p>
        </section>
      </div>

      {!closed && (
        // Bug 9 walk fix: identical broken shape to the /today entry
        // button before PR #79 (Bug 5). Mobile branch sat at
        // `bottom-0 z-20` behind the exec bottom-nav (h-16, z-30).
        // Desktop branch had no explicit anchor so it scrolled away.
        // Same fix shape as PR #79's PostSubmissionView Close strip:
        // mobile bottom-16 z-40 + iOS safe-area padding; desktop
        // anchored to bottom-right corner as a compact card.
        <div className="fixed inset-x-0 bottom-16 z-40 border-t bg-background/95 backdrop-blur p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] md:inset-x-auto md:bottom-4 md:right-4 md:left-auto md:max-w-sm md:rounded-2xl md:m-0 md:border md:shadow-lg md:pb-3">
          <Button
            type="button"
            size="lg"
            onClick={() => setConfirmOpen(true)}
            disabled={busy}
            className="w-full h-14 rounded-full"
          >
            <Icon name="flag" size="sm" />
            Close the Day
          </Button>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={(o) => !busy && setConfirmOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close today out?</DialogTitle>
            <DialogDescription>
              Once closed, today cannot be edited. Tasks become read-only and
              no new tasks can be added.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={busy}
            >
              Not yet
            </Button>
            <Button type="button" onClick={onConfirmClose} disabled={busy}>
              {busy ? (
                <>
                  <Icon name="progress_activity" size="sm" className="animate-spin" />
                  Closing…
                </>
              ) : (
                'Yes, close'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
