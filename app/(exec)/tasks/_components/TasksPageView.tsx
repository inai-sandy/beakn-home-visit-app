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
import { TaskRowWithClone } from './TaskRowWithClone';

// =============================================================================
// HVA-170: /tasks accordion view
// =============================================================================
//
// Three accordion sections, Pending open by default. Each row carries a
// re-add (clone) button that opens AddTaskSheet pre-filled via the new
// `cloneFromTask` prop (HVA-170 D5). The sheet submits as a NEW task
// (addTaskAction), default date = today (D7).
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
    linkRequestId: task.linkRequestId,
    linkLeadId: task.linkLeadId,
    // taskDate intentionally omitted — defaults to today per D7.
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
  const [cloneSource, setCloneSource] = useState<CloneFromTask | null>(null);

  function openClone(task: ExecTaskRow) {
    setCloneSource(buildCloneSource(task));
  }

  return (
    <main className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Everything open across days, plus history. Tap{' '}
          <span className="font-medium">+</span> on any row to log it again.
        </p>
      </header>

      <section
        aria-label="Tasks"
        className="rounded-3xl border bg-card shadow-sm px-4 sm:px-5"
      >
        <Accordion
          type="multiple"
          defaultValue={['pending']}
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
                      <TaskRowWithClone
                        task={t}
                        onCloneClick={() => openClone(t)}
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
                      <TaskRowWithClone
                        task={t}
                        showPostponedPill
                        onCloneClick={() => openClone(t)}
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
