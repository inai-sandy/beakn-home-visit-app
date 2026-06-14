import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { PostSubmissionTasksList } from './PostSubmissionTasksList';
import { RecentOpenTasksAccordion } from './RecentOpenTasksAccordion';

import type { ExecTaskRow } from '@/lib/exec/tasks-page-queries';

// =============================================================================
// HVA-60 C: PostSubmissionView — composed page once day_plans row exists
// =============================================================================
//
// Sections in order:
//   1. Header with day-start info + read-only banner if closedAt is set
//   2. Tasks list + bottom action FAB row — rendered by the
//      <PostSubmissionTasksList> client wrapper so it can hold optimistic
//      state for Add Task (HVA-200). The wrapper composes the next-task
//      callout, the other-tasks list, empty states, and the bottom
//      Close-Day + Add-Task FAB pair.
// =============================================================================

export interface PostSubmissionViewProps {
  dayPlan: {
    id: string;
    submittedAt: string;
    closedAt: string | null;
  };
  tasks: Array<{
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
  }>;
  outcomeOptionsByType: Record<string, Array<{ id: string; code: string; name: string }>>;
  postponeReasons: Array<{ id: string; code: string; name: string }>;
  linkableRequests: Array<{ id: string; customerName: string; customerPhone: string }>;
  linkableLeads?: Array<{ id: string; name: string; phone: string }>;
  isCloseButtonVisible: boolean;
  /** HVA-292: last-7-days open tasks not yet in today's plan. */
  recentOpenTasks?: ExecTaskRow[];
}

export function PostSubmissionView({
  dayPlan,
  tasks,
  outcomeOptionsByType,
  postponeReasons,
  linkableRequests,
  linkableLeads = [],
  isCloseButtonVisible,
  recentOpenTasks = [],
}: PostSubmissionViewProps) {
  const closed = dayPlan.closedAt !== null;

  return (
    <main className="min-h-svh bg-background pb-32">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-5">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          {closed ? (
            <Badge variant="secondary" className="text-xs">
              Closed
            </Badge>
          ) : (
            <p className="text-sm text-muted-foreground">
              {tasks.length === 0
                ? 'No tasks yet — add one to get started.'
                : `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} on your plan.`}
            </p>
          )}
        </header>

        {closed && (
          <div className="rounded-2xl border bg-muted/40 p-4 text-sm text-muted-foreground space-y-2">
            <p>
              This day is closed. Tasks can&apos;t be edited and no new tasks
              can be added.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href="/today/close">View summary</Link>
            </Button>
          </div>
        )}

        <PostSubmissionTasksList
          dayPlanClosed={closed}
          tasks={tasks}
          outcomeOptionsByType={outcomeOptionsByType}
          postponeReasons={postponeReasons}
          linkableRequests={linkableRequests}
          linkableLeads={linkableLeads}
          isCloseButtonVisible={isCloseButtonVisible}
        />

        {/* HVA-292: carry-over work still reachable after the day starts.
            Hidden once the day is closed (moving to today needs an open
            plan). */}
        {!closed && recentOpenTasks.length > 0 && (
          <div className="mt-5">
            <RecentOpenTasksAccordion tasks={recentOpenTasks} />
          </div>
        )}
      </div>
    </main>
  );
}
