'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

import type { ExecDayStatus, TeamExecStatus } from '@/lib/captain/dashboard-queries';

// =============================================================================
// HVA-80: One exec row in the team status list
// =============================================================================
//
// Tap row → inline expansion (NOT a route navigation). HVA-82 drill-down
// was cancelled; inline is the canonical interaction for v1.
// =============================================================================

function statusMeta(status: ExecDayStatus | undefined): {
  dotClass: string;
  label: string;
} {
  switch (status) {
    case 'closed':
      return { dotClass: 'bg-green-500', label: 'Day closed' };
    case 'in_progress':
      return { dotClass: 'bg-yellow-400', label: 'In progress' };
    case 'no_plan':
      return { dotClass: 'bg-red-500', label: 'Not started' };
    case 'unavailable':
      return { dotClass: 'bg-muted-foreground/40', label: 'Unavailable' };
    default:
      // Range mode — status is undefined; rangeClosedSummary takes over.
      return { dotClass: 'bg-muted-foreground/40', label: 'Range view' };
  }
}

function Avatar({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-primary/10 text-primary text-xs font-semibold shrink-0"
      aria-hidden
    >
      {initial}
    </span>
  );
}

function formatRupees(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

export function ExecStatusRow({
  exec,
  isRangeMode = false,
}: {
  exec: TeamExecStatus;
  isRangeMode?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = statusMeta(exec.status);
  const rangeLabel = exec.rangeClosedSummary
    ? `${exec.rangeClosedSummary.closed}/${exec.rangeClosedSummary.total} days closed`
    : null;

  return (
    <li className="border-t first:border-t-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={`exec-${exec.userId}-detail`}
        className="w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-muted/30 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <Avatar name={exec.fullName} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">{exec.fullName}</p>
            {exec.hasRedFlag && (
              <Badge variant="destructive" className="text-[10px]">
                ⚑ {exec.overdueTaskCount} overdue
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className={cn('inline-block h-2 w-2 rounded-full', meta.dotClass)} />
              {isRangeMode && rangeLabel ? rangeLabel : meta.label}
            </span>
            <span>·</span>
            <span>{exec.visitsToday} visits</span>
            <span>·</span>
            <span>{formatRupees(exec.collectionsTodayRupees)}</span>
          </div>
        </div>
        <Icon
          name={expanded ? 'expand_less' : 'expand_more'}
          size="sm"
          className="text-muted-foreground shrink-0"
        />
      </button>

      {expanded && (
        <div
          id={`exec-${exec.userId}-detail`}
          className="px-4 pb-3 -mt-1 text-xs text-muted-foreground space-y-2 bg-muted/10"
        >
          <div className="grid grid-cols-3 gap-2 pt-2">
            <div className="rounded-md bg-background border p-2 text-center">
              <p className="text-base font-semibold text-foreground">
                {exec.todayTaskBreakdown.done}
              </p>
              <p className="text-[10px] uppercase tracking-wide">Done</p>
            </div>
            <div className="rounded-md bg-background border p-2 text-center">
              <p className="text-base font-semibold text-foreground">
                {exec.todayTaskBreakdown.pending}
              </p>
              <p className="text-[10px] uppercase tracking-wide">Pending</p>
            </div>
            <div className="rounded-md bg-background border p-2 text-center">
              <p className="text-base font-semibold text-foreground">
                {exec.todayTaskBreakdown.postponed}
              </p>
              <p className="text-[10px] uppercase tracking-wide">Postponed</p>
            </div>
          </div>
          <p className="pt-1">
            Collections today:{' '}
            <span className="text-foreground font-medium">
              {formatRupees(exec.collectionsTodayRupees)}
            </span>
          </p>
          {exec.overdueTaskCount > 0 && (
            <p className="text-destructive">
              ⚑ {exec.overdueTaskCount} task
              {exec.overdueTaskCount === 1 ? '' : 's'} past their postpone date
              and still pending.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
