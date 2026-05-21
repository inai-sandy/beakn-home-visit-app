'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/switch';
import { setExecUnavailableAction } from '@/lib/captain/team-actions';

// =============================================================================
// HVA-167: client toggle wrapping setExecUnavailableAction
// =============================================================================
//
// Optimistic switch — UI flips immediately, server-action resolves
// asynchronously. On error we revert + toast. On success we
// router.refresh() so dependent surfaces (badges, dashboard) re-render
// on the next paint.
// =============================================================================

interface Props {
  execUserId: string;
  initial: boolean;
}

export function MarkUnavailableToggle({ execUserId, initial }: Props) {
  const router = useRouter();
  const [local, setLocal] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  async function onChange(next: boolean) {
    if (busy) return;
    setLocal(next);
    setSubmitting(true);
    try {
      const result = await setExecUnavailableAction({
        execUserId,
        isUnavailable: next,
      });
      if (!result.ok) {
        setLocal(!next);
        toast.error(result.error);
        return;
      }
      toast.success(
        next ? 'Marked unavailable for today.' : 'Marked available.',
      );
      startTransition(() => router.refresh());
    } catch (e) {
      setLocal(!next);
      toast.error('Could not update availability.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <label className="inline-flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Mark unavailable</span>
      <Switch
        checked={local}
        onCheckedChange={onChange}
        disabled={busy}
        aria-label="Mark exec unavailable today"
      />
    </label>
  );
}
