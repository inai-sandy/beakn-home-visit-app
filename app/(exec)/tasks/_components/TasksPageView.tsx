'use client';

import { useState } from 'react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

import {
  AddTaskSheet,
  type CloneFromTask,
  type LinkableLead,
  type LinkableRequest,
} from '../../today/_components/AddTaskSheet';

import type { ExecTaskRow } from '@/lib/exec/tasks-page-queries';

import { CompletedTasksList } from './CompletedTasksList';
import { MoveTaskSheet, type MoveTarget } from './MoveTaskSheet';
import { TaskRowWithAction } from './TaskRowWithAction';

// =============================================================================
// HVA-170 / HVA-170-FIX1: /tasks accordion view
// =============================================================================
//
// Three-section accordion. Action buttons differ by bucket per D15:
//   - Pending   → "+" opens MoveTaskSheet (move).
//   - Postponed → "+" opens MoveTaskSheet (reschedule).
//   - Completed → "+" opens AddTaskSheet in clone mode (re-add).
//
// Two independent state slots so the two sheets never collide. Clone
// mode no longer inherits the source's link (HVA-170-FIX1 D14) — the
// exec picks the customer manually in the sheet.
// =============================================================================

interface Props {
  pendingTasks: ExecTaskRow[];
  postponedTasks: ExecTaskRow[];
  completedGroupedByDate: Array<{ istDate: string; tasks: ExecTaskRow[] }>;
  completedPagination: {
    currentPage: number;
    totalPages: number;
    totalCount: number;
    pageSize: number;
  };
  currentFilter: { from: string | null; to: string | null };
  linkableRequests: LinkableRequest[];
  linkableLeads: LinkableLead[];
}

function buildCloneSource(task: ExecTaskRow): CloneFromTask {
  return {
    taskType: task.taskType,
    description: task.description,
    estimatedTime: task.estimatedTime,
    // HVA-170-FIX1 D14: link fields intentionally dropped — exec re-links
    // in the sheet to avoid stale-assignment validation errors.
  };
}

export function TasksPageView({
  pendingTasks,
  postponedTasks,
  completedGroupedByDate,
  completedPagination,
  currentFilter,
  linkableRequests,
  linkableLeads,
}: Props) {
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [cloneSource, setCloneSource] = useState<CloneFromTask | null>(null);

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

  function openClone(task: ExecTaskRow) {
    setCloneSource(buildCloneSource(task));
  }

  return (
    <main className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Everything open across days, plus history. Tap{' '}
          <span className="font-medium">+</span> to move a pending task,
          reschedule a postponed one, or re-add a completed one.
        </p>
      </header>

      <section
        aria-label="Tasks"
        className="rounded-3xl border bg-card shadow-sm px-4 sm:px-5"
      >
        {/* 2026-05-26 universal-closed rule: accordions never auto-open. */}
        <Accordion
          type="multiple"
          defaultValue={[]}
          className="w-full"
        >
          <AccordionItem value="pending">
            <AccordionTrigger>
              <span className="inline-flex items-center gap-2">
                Pending
                <span className="text-muted-foreground font-normal">
                  ({pendingTasks.length})
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              {pendingTasks.length === 0 ? (
                <EmptyRow text="No pending tasks anywhere. Clean slate." />
              ) : (
                <ul className="space-y-2">
                  {pendingTasks.map((t) => (
                    <li key={t.id}>
                      <TaskRowWithAction
                        task={t}
                        actionLabel="Move"
                        onActionClick={() => openMove(t)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="postponed">
            <AccordionTrigger>
              <span className="inline-flex items-center gap-2">
                Postponed
                <span className="text-muted-foreground font-normal">
                  ({postponedTasks.length})
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              {postponedTasks.length === 0 ? (
                <EmptyRow text="Nothing postponed." />
              ) : (
                <ul className="space-y-2">
                  {postponedTasks.map((t) => (
                    <li key={t.id}>
                      <TaskRowWithAction
                        task={t}
                        showPostponedPill
                        actionLabel="Reschedule"
                        onActionClick={() => openMove(t)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="completed">
            <AccordionTrigger>
              <span className="inline-flex items-center gap-2">
                Completed
                <span className="text-muted-foreground font-normal">
                  ({completedPagination.totalCount})
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <CompletedTasksList
                groupedByDate={completedGroupedByDate}
                pagination={completedPagination}
                currentFilter={currentFilter}
                onCloneClick={openClone}
              />
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

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed bg-background/50 p-4 text-sm text-muted-foreground">
      {text}
    </div>
  );
}
