'use client';

import { Icon } from '@/components/ui/icon';

import { RecentOpenTasksAccordion } from './RecentOpenTasksAccordion';
import { StartMyDayButton } from './StartMyDayButton';

import type { ExecTaskRow } from '@/lib/exec/tasks-page-queries';

// =============================================================================
// HVA-170 D6 / HVA-170-FIX1: PreSubmissionView + last-7-days open-tasks accordion
// =============================================================================
//
// Pre-submission surface (no day_plans row for today). Replaces the plain
// PreSubmissionView when the exec has open work from the past 7 days —
// the row's "+" button opens MoveTaskSheet (move for pending,
// reschedule for postponed). This accordion ONLY surfaces
// pending/postponed work, so clone is never the right action here
// (HVA-170-FIX1).
//
// When `lastWeekOpenTasks.length === 0` we collapse to the plain Start
// My Day CTA (no clutter for brand-new execs).
// =============================================================================

interface Props {
  lastWeekOpenTasks: ExecTaskRow[];
}

export function StartMyDayWithRecentTasks({ lastWeekOpenTasks }: Props) {
  return (
    <main className="min-h-[60svh] flex flex-col items-center justify-start gap-6 p-6">
      <div className="text-center space-y-5 max-w-sm pt-6">
        <Icon
          name="today"
          size="lg"
          className="text-muted-foreground/70 mx-auto"
        />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Ready to begin?
          </h1>
          <p className="text-sm text-muted-foreground">
            Start your day to track tasks, mark them done, and close out
            with your daily metrics.
          </p>
        </div>
        <div className="flex justify-center">
          <StartMyDayButton />
        </div>
      </div>

      <div className="w-full max-w-md">
        <RecentOpenTasksAccordion tasks={lastWeekOpenTasks} />
      </div>
    </main>
  );
}
