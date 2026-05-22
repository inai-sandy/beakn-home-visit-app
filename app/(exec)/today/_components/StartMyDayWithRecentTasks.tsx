'use client';

import { useState } from 'react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Icon } from '@/components/ui/icon';

import { TaskRowWithClone } from '../../tasks/_components/TaskRowWithClone';
import {
  AddTaskSheet,
  type CloneFromTask,
  type LinkableLead,
  type LinkableRequest,
} from './AddTaskSheet';
import { StartMyDayButton } from './StartMyDayButton';

import type { ExecTaskRow } from '@/lib/exec/tasks-page-queries';

// =============================================================================
// HVA-170 D6: PreSubmissionView + last-7-days open-tasks accordion
// =============================================================================
//
// Pre-submission surface (no day_plans row for today). Replaces the plain
// PreSubmissionView when the exec has any open work from the past 7 days
// — gives them a one-tap path to re-add yesterday's unfinished work
// before committing today.
//
// When `lastWeekOpenTasks.length === 0` we collapse to the plain Start
// My Day CTA (no clutter for brand-new execs).
// =============================================================================

interface Props {
  lastWeekOpenTasks: ExecTaskRow[];
  linkableRequests: LinkableRequest[];
  linkableLeads: LinkableLead[];
}

function buildCloneSource(task: ExecTaskRow): CloneFromTask {
  return {
    taskType: task.taskType,
    description: task.description,
    estimatedTime: task.estimatedTime,
    linkRequestId: task.linkRequestId,
    linkLeadId: task.linkLeadId,
  };
}

export function StartMyDayWithRecentTasks({
  lastWeekOpenTasks,
  linkableRequests,
  linkableLeads,
}: Props) {
  const [cloneSource, setCloneSource] = useState<CloneFromTask | null>(null);

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
                  <span className="font-medium">+</span> to re-add a row to
                  today.
                </p>
                <ul className="space-y-2">
                  {lastWeekOpenTasks.map((t) => (
                    <li key={t.id}>
                      <TaskRowWithClone
                        task={t}
                        showPostponedPill={t.status === 'postponed'}
                        onCloneClick={() =>
                          setCloneSource(buildCloneSource(t))
                        }
                      />
                    </li>
                  ))}
                </ul>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>
      )}

      {cloneSource !== null && (
        <AddTaskSheet
          linkableRequests={linkableRequests}
          linkableLeads={linkableLeads}
          cloneFromTask={cloneSource}
          onClose={() => setCloneSource(null)}
        />
      )}
    </main>
  );
}
