import { Icon } from '@/components/ui/icon';

import { StartMyDayButton } from './StartMyDayButton';

// =============================================================================
// HVA-60 A (pre-submission branch): placeholder + Start My Day CTA
// =============================================================================
//
// Renders when no day_plans row exists for (current exec, today IST). One
// click of the StartMyDayButton creates the row and the page re-renders
// to PostSubmissionView via router.refresh.
//
// Path C scope (bundle locked decision): we don't yet have a Scheduled
// Visits acknowledge flow. The pre-submission state is intentionally a
// single button — keeps the post-submission loop fully exercisable while
// HVA-57 (scheduled-visits source) is unblocked.
// =============================================================================

export function PreSubmissionView() {
  return (
    <main className="min-h-[60svh] flex items-center justify-center p-6">
      <div className="text-center space-y-5 max-w-sm">
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
    </main>
  );
}
