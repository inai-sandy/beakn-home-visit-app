'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/switch';
import {
  loadAffectedFutureVisitsForExec,
  loadTeammatesForRebalance,
  type AffectedVisitRow,
} from '@/lib/captain/rebalance-actions';
import { setExecUnavailableAction } from '@/lib/captain/team-actions';

import { RebalanceDialog } from './RebalanceDialog';

// =============================================================================
// HVA-167 + HVA-85: Mark Unavailable toggle + rebalance prompt
// =============================================================================
//
// Toggle flips sales_executives.is_unavailable. HVA-85 layer: when the
// toggle goes to UNAVAILABLE, query for future-scheduled visits assigned
// to this exec; if any, open the rebalance dialog so the captain can
// redistribute the workload immediately.
// =============================================================================

interface Props {
  execUserId: string;
  execName: string;
  captainUserId: string;
  initial: boolean;
}

export function MarkUnavailableToggle({
  execUserId,
  execName,
  captainUserId,
  initial,
}: Props) {
  const router = useRouter();
  const [local, setLocal] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [rebalance, setRebalance] = useState<
    | null
    | {
        visits: AffectedVisitRow[];
        teammates: Array<{ id: string; fullName: string }>;
      }
  >(null);
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

      // HVA-85: on the unavailable transition, check for affected future
      // visits and offer to rebalance. We do this AFTER the toggle so the
      // exec is already flagged when the captain confirms reassignments
      // (the new destination is validated to be available, not the source).
      if (next) {
        const [visits, teammates] = await Promise.all([
          loadAffectedFutureVisitsForExec(execUserId),
          loadTeammatesForRebalance(captainUserId, execUserId),
        ]);
        if (visits.length > 0) {
          setRebalance({ visits, teammates });
        }
      }

      startTransition(() => router.refresh());
    } catch {
      setLocal(!next);
      toast.error('Could not update availability.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <label className="inline-flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Mark unavailable</span>
        <Switch
          checked={local}
          onCheckedChange={onChange}
          disabled={busy}
          aria-label="Mark exec unavailable today"
        />
      </label>
      {rebalance && (
        <RebalanceDialog
          open
          onClose={() => setRebalance(null)}
          fromExecUserId={execUserId}
          fromExecName={execName}
          visits={rebalance.visits}
          teammates={rebalance.teammates}
        />
      )}
    </>
  );
}
