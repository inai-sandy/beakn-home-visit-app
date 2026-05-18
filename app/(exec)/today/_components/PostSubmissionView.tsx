import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

import { AddTaskFab } from './AddTaskSheet';
import { TaskItem } from './TaskItem';

// =============================================================================
// HVA-60 C: PostSubmissionView — composed page once day_plans row exists
// =============================================================================
//
// Sections in order:
//   1. Header with day-start info + read-only banner if closedAt is set
//   2. Next Task card — oldest pending task, highlighted larger
//   3. Tasks list — every task ordered by createdAt asc
//   4. Empty state when there are no tasks at all
//   5. Add Task FAB (hidden when closedAt is set)
//   6. Sticky Close the Day button (visible only after day_close_target_time
//      AND when not yet closed; otherwise routes to /today/close as a
//      View summary link)
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
    linkRequestId: string | null;
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
  isCloseButtonVisible: boolean;
}

export function PostSubmissionView({
  dayPlan,
  tasks,
  outcomeOptionsByType,
  postponeReasons,
  linkableRequests,
  isCloseButtonVisible,
}: PostSubmissionViewProps) {
  const closed = dayPlan.closedAt !== null;

  // "Next task" — first pending task by createdAt ascending. The task
  // rows arrive already ordered ASC, so the first match is the right
  // one. Returns null when there are no pending tasks (all done /
  // postponed / empty plan).
  const nextTask = tasks.find((t) => t.status === 'pending') ?? null;
  const otherTasks = nextTask
    ? tasks.filter((t) => t.id !== nextTask.id)
    : tasks;

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

        {nextTask && (
          <section aria-label="Next task" className="space-y-2">
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
              Next task
            </h2>
            <TaskItem
              task={nextTask}
              outcomeOptionsForType={outcomeOptionsByType[nextTask.taskType] ?? []}
              postponeReasons={postponeReasons}
              readOnly={closed}
              highlighted
            />
          </section>
        )}

        <section aria-label="All tasks" className="space-y-3">
          {nextTask && otherTasks.length > 0 && (
            <h2 className="text-xs uppercase tracking-wide text-muted-foreground">
              Other tasks
            </h2>
          )}
          {!nextTask && tasks.length === 0 && (
            <div className="rounded-3xl border bg-muted/40 p-10 text-center space-y-3">
              <Icon
                name="check_circle"
                size="lg"
                className="text-muted-foreground/70 mx-auto"
              />
              <p className="text-sm text-muted-foreground">
                {closed
                  ? 'No tasks were tracked today.'
                  : 'No pending tasks — well done! Add another with the + button.'}
              </p>
            </div>
          )}
          {!nextTask && tasks.length > 0 && (
            // All tasks are done / postponed — show them in order.
            <div className="rounded-3xl border bg-muted/30 p-6 text-center mb-3">
              <p className="text-sm font-medium">All tasks handled — well done!</p>
              {!closed && (
                <p className="text-xs text-muted-foreground mt-1">
                  Add another with the + button, or close out the day.
                </p>
              )}
            </div>
          )}
          {otherTasks.map((t) => (
            <TaskItem
              key={t.id}
              task={t}
              outcomeOptionsForType={outcomeOptionsByType[t.taskType] ?? []}
              postponeReasons={postponeReasons}
              readOnly={closed}
            />
          ))}
        </section>
      </div>

      {/* HVA-60 design polish (Change A): the full-width Close strip is
          gone. AddTaskFab and the new Close-the-Day button render as a
          compact action pair in the bottom-right corner of the viewport,
          on both mobile and desktop. The Close button stays gated on
          time-of-day + not-yet-closed; the FAB is always visible (when
          the day isn't closed).

          Mobile: `bottom-20` lifts the cluster above the exec bottom-nav
          (h-16). `pb-[env(safe-area-inset-bottom)]` adds the iOS notch
          buffer so the buttons don't hide under the home indicator.
          Desktop: `md:bottom-4` anchors to the viewport corner.

          z-30 sits above page content but below sonner toasts (which
          self-set very-high z). Both buttons share the same z so neither
          covers the other. */}
      {!closed && (
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
          <AddTaskFab linkableRequests={linkableRequests} disabled={closed} />
        </div>
      )}
    </main>
  );
}
