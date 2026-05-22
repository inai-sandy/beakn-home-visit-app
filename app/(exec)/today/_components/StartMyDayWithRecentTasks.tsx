'use client';

import { useState } from 'react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Icon } from '@/components/ui/icon';

import {
  MoveTaskSheet,
  type MoveTarget,
} from '../../tasks/_components/MoveTaskSheet';
import { TaskRowWithAction } from '../../tasks/_components/TaskRowWithAction';

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
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);

  function openMove(task: ExecTaskRow) {
    const status = task.status === 'postponed' ? 'postponed' : 'pending';
    const currentDate =
      status === 'postponed'
        ? task.postponedToDate ?? task.taskDate
        : task.taskDate;
    setMoveTarget({
      taskId: task.id,
      status,
      currentDate,
      description: task.description,
    });
  }

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

      {lastWeekOpenTasks.length > 0 && (
        <section
          aria-label="Recent open tasks"
          className="w-full max-w-md rounded-3xl border bg-card shadow-sm px-4 sm:px-5"
        >
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="recent">
              <AccordionTrigger>
                <span className="inline-flex items-center gap-2">
                  Recent open tasks
                  <span className="text-muted-foreground font-normal">
                    ({lastWeekOpenTasks.length})
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <p className="text-[11px] text-muted-foreground mb-3">
                  Pending and postponed work from the last 7 days. Tap{' '}
                  <span className="font-medium">+</span> to move it to a
                  new date.
                </p>
                <ul className="space-y-2">
                  {lastWeekOpenTasks.map((t) => {
                    const isPostponed = t.status === 'postponed';
                    return (
                      <li key={t.id}>
                        <TaskRowWithAction
                          task={t}
                          showPostponedPill={isPostponed}
                          actionLabel={isPostponed ? 'Reschedule' : 'Move'}
                          onActionClick={() => openMove(t)}
                        />
                      </li>
                    );
                  })}
                </ul>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>
      )}

      {moveTarget !== null && (
        <MoveTaskSheet
          target={moveTarget}
          onClose={() => setMoveTarget(null)}
        />
      )}
    </main>
  );
}
