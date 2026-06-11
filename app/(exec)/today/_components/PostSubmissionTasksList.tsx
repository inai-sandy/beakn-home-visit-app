'use client';

import Link from 'next/link';
import { useState } from 'react';

import { AnimatedItem, AnimatedList } from '@/components/motion/motion-kit';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

import { AddTaskFab } from './AddTaskSheet';
import { TaskItem } from './TaskItem';

// =============================================================================
// HVA-150 (opt-in pattern) + HVA-200: optimistic Add Task on /today
// =============================================================================
//
// This client wrapper owns the tasks list rendering + the AddTaskFab so it
// can hold optimistic state. Mirrors the canonical pattern from
// components/notes/NotesSection.tsx:
//   - useState<LocalTask[]> for optimistic rows
//   - Merge server + optimistic, dedup by id
//   - On AddTaskSheet's `onOptimisticAdd`: prepend a `pending: true` row
//   - On `onOptimisticReconcile`: swap the temp id for the server id so the
//     next router.refresh's server data deduplicates the optimistic copy
//   - On `onOptimisticRemove` (action failure): drop the temp row
//
// Why a separate wrapper instead of inlining into PostSubmissionView:
// PostSubmissionView is a Server Component (it composes RSC props from
// /today's loaders). Optimistic state needs `useState`, which forces the
// client boundary. Keeping the wrapper narrow lets the rest of /today
// stay on the server.
//
// Optimistic is opt-in only for ADD mode. Edit/clone go through the
// existing useTransition path (no double-submit risk; user immediately
// sees the result on router.refresh and the form is the only surface).
// =============================================================================

type ServerTask = {
  id: string;
  taskType: string;
  description: string;
  estimatedTime: string;
  status: string;
  taskDate: string;
  linkRequestId: string | null;
  linkLeadId: string | null;
  outcomeOptionId: string | null;
  outcomeOptionName: string | null;
  outcomeNotes: string | null;
  postponedToDate: string | null;
  customerInformed: boolean | null;
  createdAt: string;
};

interface LocalTask extends ServerTask {
  pending?: boolean;
}

export interface OptimisticTaskInsert {
  id: string;
  taskType: string;
  description: string;
  estimatedTime: string;
  taskDate: string;
  linkRequestId: string | null;
  linkLeadId: string | null;
}

export interface PostSubmissionTasksListProps {
  dayPlanClosed: boolean;
  tasks: ServerTask[];
  outcomeOptionsByType: Record<string, Array<{ id: string; code: string; name: string }>>;
  postponeReasons: Array<{ id: string; code: string; name: string }>;
  linkableRequests: Array<{ id: string; customerName: string; customerPhone: string }>;
  linkableLeads: Array<{ id: string; name: string; phone: string }>;
  isCloseButtonVisible: boolean;
}

export function PostSubmissionTasksList({
  dayPlanClosed,
  tasks: serverTasks,
  outcomeOptionsByType,
  postponeReasons,
  linkableRequests,
  linkableLeads,
  isCloseButtonVisible,
}: PostSubmissionTasksListProps) {
  const [optimistic, setOptimistic] = useState<LocalTask[]>([]);

  // Merge optimistic + server, dedup by id. Optimistic rows are appended
  // (showing as "Next task" or in the "Other tasks" list depending on
  // status — all optimistic rows start with status='pending').
  const seen = new Set<string>();
  const merged: LocalTask[] = [];
  for (const t of serverTasks) {
    if (!seen.has(t.id)) {
      merged.push(t);
      seen.add(t.id);
    }
  }
  for (const t of optimistic) {
    if (!seen.has(t.id)) {
      merged.push(t);
      seen.add(t.id);
    }
  }

  // Sort: pending first by createdAt asc (matches the server query order),
  // then non-pending. Optimistic rows have a forward-dated createdAt so
  // they appear at the bottom of the pending group — feels natural since
  // they're newest.
  merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const nextTask = merged.find((t) => t.status === 'pending') ?? null;
  const otherTasks = nextTask ? merged.filter((t) => t.id !== nextTask.id) : merged;

  function handleOptimisticAdd(input: OptimisticTaskInsert) {
    const tempRow: LocalTask = {
      id: input.id,
      taskType: input.taskType,
      description: input.description,
      estimatedTime: input.estimatedTime,
      status: 'pending',
      taskDate: input.taskDate,
      linkRequestId: input.linkRequestId,
      linkLeadId: input.linkLeadId,
      outcomeOptionId: null,
      outcomeOptionName: null,
      outcomeNotes: null,
      postponedToDate: null,
      customerInformed: null,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setOptimistic((prev) => [...prev, tempRow]);
  }

  function handleOptimisticReconcile(tempId: string, serverTaskId: string) {
    // Swap the temp id for the server id. Once router.refresh resolves
    // and the server task list lands, the merge above dedups by id and
    // the optimistic copy drops out on the next render.
    setOptimistic((prev) =>
      prev.map((t) => (t.id === tempId ? { ...t, id: serverTaskId, pending: false } : t)),
    );
    // Defer-cleanup: even if router.refresh hasn't landed yet, drop the
    // optimistic copy after a short window so we don't carry stale state
    // forever (matters if the user adds 10 tasks rapidly).
    setTimeout(() => {
      setOptimistic((prev) => prev.filter((t) => t.id !== serverTaskId));
    }, 3000);
  }

  function handleOptimisticRemove(tempId: string) {
    setOptimistic((prev) => prev.filter((t) => t.id !== tempId));
  }

  return (
    <>
      <section aria-label="Today's tasks" className="space-y-3">
        {!dayPlanClosed && merged.length === 0 && (
          <div className="rounded-3xl border bg-muted/40 p-10 text-center space-y-3">
            <Icon
              name="check_circle"
              size="lg"
              className="text-muted-foreground/70 mx-auto"
            />
            <p className="text-sm text-muted-foreground">
              No pending tasks — well done! Add another with the + button.
            </p>
          </div>
        )}
        {dayPlanClosed && merged.length === 0 && (
          <div className="rounded-3xl border bg-muted/40 p-10 text-center space-y-3">
            <Icon
              name="check_circle"
              size="lg"
              className="text-muted-foreground/70 mx-auto"
            />
            <p className="text-sm text-muted-foreground">
              No tasks were tracked today.
            </p>
          </div>
        )}
        {nextTask && (
          <div className="space-y-2">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
              Next task
            </h2>
            <div className={nextTask.pending ? 'opacity-70 pointer-events-none' : undefined}>
              <TaskItem
                task={nextTask}
                outcomeOptionsForType={outcomeOptionsByType[nextTask.taskType] ?? []}
                postponeReasons={postponeReasons}
                readOnly={dayPlanClosed || (nextTask.pending ?? false)}
                highlighted
                linkableRequests={linkableRequests}
                linkableLeads={linkableLeads}
              />
            </div>
          </div>
        )}
        {nextTask && otherTasks.length > 0 && (
          <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
            Other tasks
          </h2>
        )}
        {!nextTask && merged.length > 0 && (
          <div className="rounded-3xl border bg-muted/30 p-6 text-center mb-3">
            <p className="text-sm font-medium">All tasks handled — well done!</p>
            {!dayPlanClosed && (
              <p className="text-xs text-muted-foreground mt-1">
                Add another with the + button, or close out the day.
              </p>
            )}
          </div>
        )}
        {/* HVA-267: rows rise in when added and collapse out when they
            leave this group (done / postponed / promoted to next-task);
            survivors glide into place via layout. */}
        <AnimatedList>
          {otherTasks.map((t) => (
            <AnimatedItem
              key={t.id}
              className={t.pending ? 'opacity-70 pointer-events-none' : undefined}
            >
              <TaskItem
                task={t}
                outcomeOptionsForType={outcomeOptionsByType[t.taskType] ?? []}
                postponeReasons={postponeReasons}
                readOnly={dayPlanClosed || (t.pending ?? false)}
                linkableRequests={linkableRequests}
                linkableLeads={linkableLeads}
              />
            </AnimatedItem>
          ))}
        </AnimatedList>
      </section>

      {!dayPlanClosed && (
        <div
          className="fixed bottom-20 right-4 z-30 flex items-center gap-2 pb-[env(safe-area-inset-bottom)] md:bottom-4 md:pb-0"
          aria-label="Day actions"
        >
          {isCloseButtonVisible && (
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-14 px-5 rounded-full shadow-lg bg-background"
            >
              <Link href="/today/close">
                <Icon name="flag" size="sm" />
                Close Day
              </Link>
            </Button>
          )}
          <AddTaskFab
            linkableRequests={linkableRequests}
            linkableLeads={linkableLeads}
            disabled={dayPlanClosed}
            onOptimisticAdd={handleOptimisticAdd}
            onOptimisticReconcile={handleOptimisticReconcile}
            onOptimisticRemove={handleOptimisticRemove}
          />
        </div>
      )}
    </>
  );
}
