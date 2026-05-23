'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

import type { ExecTaskRow } from '@/lib/exec/tasks-page-queries';

// =============================================================================
// HVA-170 / HVA-170-FIX1: task row with an action button (move / reschedule / re-add)
// =============================================================================
//
// Single-row presentation used inside the Pending / Postponed / Completed
// accordion sections on /tasks plus the Start-My-Day recent-tasks accordion.
// The "+" button on the right calls the parent's onActionClick. Parents
// choose whether this opens MoveTaskSheet (pending/postponed → move /
// reschedule) or AddTaskSheet (completed → re-add) and supply the
// `actionLabel` ("Move" / "Reschedule" / "Re-add") for the aria-label.
//
// `showPostponedPill` causes a "Scheduled for <date>" badge to render when
// `postponed_to_date` is set — that's the future-postponed signal on the
// Postponed accordion (D11).
// =============================================================================

interface Props {
  task: ExecTaskRow;
  showPostponedPill?: boolean;
  showCompletedTimestamp?: boolean;
  /** "Move" / "Reschedule" / "Re-add" — drives the aria-label only. */
  actionLabel: string;
  onActionClick: () => void;
}

function formatIstDate(istDate: string): string {
  const [y, m, d] = istDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  });
}

function formatCompletedAt(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
}

export function TaskRowWithAction({
  task,
  showPostponedPill = false,
  showCompletedTimestamp = false,
  actionLabel,
  onActionClick,
}: Props) {
  const showPill = showPostponedPill && task.postponedToDate !== null;
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border bg-card p-3',
        'shadow-sm',
      )}
    >
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant="secondary"
            className="text-[10px] uppercase tracking-wide"
          >
            {task.taskType}
          </Badge>
          {showPill && (
            <Badge
              variant="outline"
              className="text-[10px] gap-1 border-amber-500/50 text-amber-700 dark:text-amber-300"
            >
              <Icon name="event_upcoming" size="xs" aria-hidden />
              Scheduled for {formatIstDate(task.postponedToDate!)}
            </Badge>
          )}
        </div>
        <p className="text-sm font-medium leading-snug break-words">
          {task.description}
        </p>
        {task.linkedCustomerName && (
          <p className="text-[11px] inline-flex items-center gap-1 text-foreground/80">
            <Icon
              name={task.linkLeadId ? 'person_add' : 'person'}
              size="xs"
              className="text-muted-foreground"
              aria-hidden
            />
            <span className="truncate font-medium">
              {task.linkedCustomerName}
            </span>
          </p>
        )}
        <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
          <Icon name="schedule" size="xs" aria-hidden />
          {task.estimatedTime}
          <span aria-hidden> · </span>
          {showCompletedTimestamp && task.completedAt
            ? `Completed ${formatCompletedAt(task.completedAt)}`
            : formatIstDate(task.taskDate)}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`${actionLabel}: ${task.description}`}
        onClick={onActionClick}
        className="shrink-0 h-9 w-9"
      >
        <Icon name="add" size="sm" />
      </Button>
    </div>
  );
}
