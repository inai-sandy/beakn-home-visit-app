'use client';

import { useState } from 'react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

import {
  MoveTaskSheet,
  type MoveTarget,
} from '../../tasks/_components/MoveTaskSheet';
import { TaskRowWithAction } from '../../tasks/_components/TaskRowWithAction';

import type { ExecTaskRow } from '@/lib/exec/tasks-page-queries';

// =============================================================================
// HVA-292: reusable "Recent open tasks" accordion
// =============================================================================
//
// Pending/postponed work from the last 7 days, each row's "+" opening
// MoveTaskSheet (Move for pending → today attaches it to today's plan;
// Reschedule for postponed). Shown on the Start-my-day screen AND on the
// live today view after the day is started — previously it only appeared
// pre-start, so once you started the day you could no longer pull a
// carried-over task into today.
// =============================================================================

interface Props {
  tasks: ExecTaskRow[];
}

export function RecentOpenTasksAccordion({ tasks }: Props) {
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);

  if (tasks.length === 0) return null;

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
    <>
      <section
        aria-label="Recent open tasks"
        className="w-full rounded-3xl border bg-card shadow-sm px-4 sm:px-5"
      >
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="recent">
            <AccordionTrigger>
              <span className="inline-flex items-center gap-2">
                Recent open tasks
                <span className="text-muted-foreground font-normal">
                  ({tasks.length})
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <p className="text-[11px] text-muted-foreground mb-3">
                Pending and postponed work from the last 7 days not yet in
                today&apos;s plan. Tap <span className="font-medium">+</span>{' '}
                and move it to today to add it.
              </p>
              <ul className="space-y-2">
                {tasks.map((t) => {
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

      {moveTarget !== null && (
        <MoveTaskSheet
          target={moveTarget}
          onClose={() => setMoveTarget(null)}
        />
      )}
    </>
  );
}
