import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

import type { ExecDashboardBannerState } from '@/lib/exec/dashboard-queries';

// =============================================================================
// HVA-169 — exec dashboard status banner (D2)
// =============================================================================
//
// Server-rendered card switching on the banner state machine. Four states:
//
//   no_plan     — yellow attention card, CTA "Submit Day Plan" → /today
//   in_progress — green progress card with task counts + next-pending title
//   closeable   — green attention card, CTA "Close Day" → /today/close
//   closed      — muted card with closed-at timestamp
//
// All four share the same outer shape (rounded-3xl card) so layout shift
// across re-renders is minimal as the day evolves.
// =============================================================================

interface Props {
  state: ExecDashboardBannerState;
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

export function StatusBanner({ state }: Props) {
  if (state.kind === 'no_plan') {
    return (
      <section
        aria-label="Day plan status"
        className={cn(
          'rounded-3xl border bg-card p-5 shadow-sm space-y-3',
          'border-l-4 border-l-yellow-500',
        )}
      >
        <div className="flex items-start gap-3">
          <Icon name="today" size="md" className="text-yellow-600 mt-0.5" aria-hidden />
          <div className="flex-1 space-y-1.5">
            <h2 className="text-base font-semibold tracking-tight">
              You haven&apos;t started your day yet
            </h2>
            <p className="text-sm text-muted-foreground">
              Submit a day plan to track tasks, close the day, and unlock today&apos;s
              metrics.
            </p>
          </div>
        </div>
        <Button asChild>
          <Link href="/today">Submit Day Plan</Link>
        </Button>
      </section>
    );
  }

  if (state.kind === 'in_progress') {
    return (
      <section
        aria-label="Day plan status"
        className={cn(
          'rounded-3xl border bg-card p-5 shadow-sm space-y-3',
          'border-l-4 border-l-primary',
        )}
      >
        <div className="flex items-start gap-3">
          <Icon name="schedule" size="md" className="text-primary mt-0.5" aria-hidden />
          <div className="flex-1 space-y-1.5">
            <h2 className="text-base font-semibold tracking-tight">Day in progress</h2>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{state.pending}</span> pending
              <span aria-hidden> · </span>
              <span className="font-medium text-foreground">{state.done}</span> done
              <span aria-hidden> · </span>
              <span className="font-medium text-foreground">{state.postponed}</span> postponed
            </p>
            {state.nextPendingTaskTitle !== null && (
              <p className="text-sm">
                <span className="text-muted-foreground">Next: </span>
                <span className="font-medium">{state.nextPendingTaskTitle}</span>
              </p>
            )}
          </div>
        </div>
        <Button asChild variant="outline">
          <Link href="/today">Open today&apos;s plan</Link>
        </Button>
      </section>
    );
  }

  if (state.kind === 'closeable') {
    return (
      <section
        aria-label="Day plan status"
        className={cn(
          'rounded-3xl border bg-card p-5 shadow-sm space-y-3',
          'border-l-4 border-l-green-600',
        )}
      >
        <div className="flex items-start gap-3">
          <Icon name="check_circle" size="md" className="text-green-600 mt-0.5" aria-hidden />
          <div className="flex-1 space-y-1.5">
            <h2 className="text-base font-semibold tracking-tight">Ready to close the day</h2>
            <p className="text-sm text-muted-foreground">
              The close window opened at {state.closeWindowHHMM}. Lock today&apos;s
              performance and start fresh tomorrow.
            </p>
          </div>
        </div>
        <Button asChild>
          <Link href="/today/close">Close Day</Link>
        </Button>
      </section>
    );
  }

  // closed
  return (
    <section
      aria-label="Day plan status"
      className={cn(
        'rounded-3xl border bg-muted/40 p-5 space-y-1.5',
        'border-l-4 border-l-muted-foreground/30',
      )}
    >
      <div className="flex items-start gap-3">
        <Icon name="lock" size="md" className="text-muted-foreground mt-0.5" aria-hidden />
        <div className="flex-1 space-y-1.5">
          <h2 className="text-base font-semibold tracking-tight">
            Day closed at {formatTime(state.closedAt)}
          </h2>
          <p className="text-sm text-muted-foreground">
            Tomorrow&apos;s plan opens at the start of the next IST day. Today&apos;s
            metrics are locked below.
          </p>
        </div>
      </div>
    </section>
  );
}
