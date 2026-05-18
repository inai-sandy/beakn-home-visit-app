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
import { cn } from '@/lib/utils';

import type { DayCloseMetrics, TargetCell } from '@/lib/today/metrics';

import { closeDayAction } from '../../actions';

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

function StatusDot({ status }: { status: TargetCell['status'] }) {
  const cls =
    status === 'green'
      ? 'bg-green-500'
      : status === 'yellow'
        ? 'bg-yellow-400'
        : status === 'red'
          ? 'bg-red-500'
          : 'bg-muted-foreground/40';
  return <span aria-hidden className={cn('inline-block h-2 w-2 rounded-full', cls)} />;
}

function MetricTile({
  label,
  cell,
  formatActual,
}: {
  label: string;
  cell: TargetCell;
  formatActual: (n: number) => string;
}) {
  const actualText =
    cell.actual === null ? '—' : formatActual(cell.actual);
  return (
    <div className="rounded-2xl border bg-card p-4 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {cell.status === 'no_target' ? (
          <Badge variant="outline" className="text-[10px]">
            No target
          </Badge>
        ) : (
          <StatusDot status={cell.status} />
        )}
      </div>
      <p className="text-2xl font-semibold tracking-tight">{actualText}</p>
      {cell.target !== null && cell.status !== 'no_target' && (
        <p className="text-[11px] text-muted-foreground">
          Target {formatActual(cell.target)}
        </p>
      )}
    </div>
  );
}

function formatInteger(n: number): string {
  return Math.round(n).toLocaleString('en-IN');
}

function formatRupees(rupees: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(rupees);
}

function formatPercent(p: number): string {
  return `${Math.round(p)}%`;
}

export function CloseDayView({ dayPlan, metrics }: Props) {
  const router = useRouter();
  const closed = dayPlan.closedAt !== null;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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

  const { taskCounts, amountCollectedPaise, inboundPaymentCount, quotationsCount, targets } =
    metrics;
  const rupees = amountCollectedPaise / 100;

  return (
    <main className="min-h-svh bg-background pb-32">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-6">
        <header className="space-y-2">
          <div className="flex items-center justify-center">
            <div className="h-24 w-24 rounded-full bg-primary/10 flex items-center justify-center">
              <Icon name="flag" size="lg" className="text-primary" />
            </div>
          </div>
          <h1 className="text-center text-3xl font-semibold tracking-tight">
            Close the Day
          </h1>
          <p className="text-center text-sm text-muted-foreground">
            {closed
              ? 'Day already closed. This is a read-only summary.'
              : "Here's how today shaped up. Confirm to close out."}
          </p>
        </header>

        {/* 6-metric grid */}
        <section aria-label="Daily targets" className="grid grid-cols-2 gap-3">
          <MetricTile
            label="Revenue"
            cell={targets.revenue}
            formatActual={(n) => formatRupees(n)}
          />
          <MetricTile
            label="Visits"
            cell={targets.visits}
            formatActual={(n) => formatInteger(n)}
          />
          <MetricTile
            label="Quotations"
            cell={targets.quotations}
            formatActual={(n) => formatInteger(n)}
          />
          <MetricTile
            label="Orders closed"
            cell={targets.orders}
            formatActual={(n) => formatInteger(n)}
          />
          <MetricTile
            label="Conversion"
            cell={targets.conversionPct}
            formatActual={(n) => formatPercent(n)}
          />
          <MetricTile
            label="Tasks done"
            cell={targets.taskCompletionPct}
            formatActual={(n) => formatPercent(n)}
          />
        </section>

        {/* Plan vs Actual */}
        <section
          aria-label="Plan vs Actual"
          className="rounded-2xl border bg-card p-5 space-y-3"
        >
          <h2 className="text-sm font-semibold">Plan vs Actual</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Done</dt>
              <dd className="text-lg font-semibold">{taskCounts.done}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Postponed</dt>
              <dd className="text-lg font-semibold">{taskCounts.postponed}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Pending</dt>
              <dd className="text-lg font-semibold">{taskCounts.pending}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Added during day</dt>
              <dd className="text-lg font-semibold">{taskCounts.addedDuringDay}</dd>
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
