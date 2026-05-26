'use client';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useServerMutation } from '@/lib/hooks/use-server-mutation';

import { startDayAction } from '../actions';

// =============================================================================
// HVA-60 B: StartMyDayButton
// =============================================================================
//
// Single CTA on the pre-submission view. Calls startDayAction (idempotent
// INSERT via ON CONFLICT DO NOTHING). 2026-05-26: migrated to
// useServerMutation so the refresh-required pattern lives in one place;
// the previous hand-rolled useTransition + router.refresh duo was the
// HVA-136 walk-bug class.
// =============================================================================

export function StartMyDayButton() {
  const { mutate, isPending: busy } = useServerMutation(startDayAction);

  return (
    <Button
      type="button"
      onClick={() => {
        void mutate(undefined);
      }}
      disabled={busy}
      className="w-full sm:w-auto h-14 px-8 text-base font-medium rounded-full"
    >
      {busy ? (
        <>
          <Icon name="progress_activity" size="sm" className="animate-spin" />
          <span>Starting…</span>
        </>
      ) : (
        <>
          <Icon name="play_arrow" size="sm" />
          <span>Start My Day</span>
        </>
      )}
    </Button>
  );
}
