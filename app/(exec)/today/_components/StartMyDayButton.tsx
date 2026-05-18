'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

import { startDayAction } from '../actions';

// =============================================================================
// HVA-60 B: StartMyDayButton
// =============================================================================
//
// Single CTA on the pre-submission view. Calls startDayAction (idempotent
// INSERT via ON CONFLICT DO NOTHING) and router.refresh() after success;
// the server gate re-evaluates and renders the post-submission view.
//
// HVA-136 wrap: useTransition keeps `isPending` true until the RSC fetch
// from router.refresh resolves, so the button stays disabled across the
// full request → server-render → client-reconcile window. Without the
// transition wrap, a fast double-tap could fire the action twice; the
// ON CONFLICT DO NOTHING makes that a no-op, but disabling the button
// is the correct UX signal.
// =============================================================================

export function StartMyDayButton() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  async function onClick() {
    if (busy) return;
    setSubmitting(true);
    try {
      const result = await startDayAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button
      type="button"
      onClick={onClick}
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
