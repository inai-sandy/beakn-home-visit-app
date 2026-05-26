'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Switch } from '@/components/ui/switch';
import {
  loadAffectedFutureVisitsForExec,
  loadTeammatesForRebalance,
  type AffectedVisitRow,
} from '@/lib/captain/rebalance-actions';
import { setExecUnavailableAction } from '@/lib/captain/team-actions';
import { useServerMutation } from '@/lib/hooks/use-server-mutation';

import { RebalanceDialog } from './RebalanceDialog';

// =============================================================================
// HVA-167 + HVA-85: Mark Unavailable toggle + rebalance prompt
// =============================================================================
//
// Toggle flips sales_executives.is_unavailable. HVA-85 layer: when the
// toggle goes to UNAVAILABLE, query for future-scheduled visits assigned
// to this exec; if any, open the rebalance dialog so the captain can
// redistribute the workload immediately.
//
// 2026-05-26: migrated to useServerMutation; the rebalance side-effect
// fires inside onSuccess so the action's post-commit hook has consistent
// shape with every other mutation site.
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
  const [local, setLocal] = useState(initial);
  const [pendingNext, setPendingNext] = useState<boolean | null>(null);
  const [rebalance, setRebalance] = useState<
    | null
    | {
        visits: AffectedVisitRow[];
        teammates: Array<{ id: string; fullName: string }>;
      }
  >(null);

  const { mutate, isPending: busy } = useServerMutation(
    setExecUnavailableAction,
    {
      onSuccess: async () => {
        const next = pendingNext;
        toast.success(
          next ? 'Marked unavailable for today.' : 'Marked available.',
        );
        if (next === true) {
          const [visits, teammates] = await Promise.all([
            loadAffectedFutureVisitsForExec(execUserId),
            loadTeammatesForRebalance(captainUserId, execUserId),
          ]);
          if (visits.length > 0) {
            setRebalance({ visits, teammates });
          }
        }
      },
      onError: () => {
        // Roll back the optimistic toggle on failure.
        if (pendingNext !== null) setLocal(!pendingNext);
      },
    },
  );

  function onChange(next: boolean) {
    if (busy) return;
    setLocal(next);
    setPendingNext(next);
    void mutate({ execUserId, isUnavailable: next });
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
