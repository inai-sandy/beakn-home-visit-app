'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useServerMutation } from '@/lib/hooks/use-server-mutation';
import { cn } from '@/lib/utils';
import { NEXT_STAGE, type DispatchStage } from '@/lib/validators/dispatch-stage';

import { advanceDispatchStageAction } from '../../../_actions/advanceDispatchStage';

// =============================================================================
// HVA-239 (HVA-231 Phase 2 PR-B): dispatch history block on /support/orders/[id]
// =============================================================================

interface DispatchEntry {
  dispatchId: string;
  createdAtIso: string;
  dispatchedByName: string | null;
  notes: string | null;
  currentStage: DispatchStage;
  items: Array<{ lineItemId: string; productName: string; qty: number }>;
}

interface Props {
  dispatches: DispatchEntry[];
}

const STAGE_LABEL: Record<DispatchStage, string> = {
  created: 'Created',
  packed: 'Packed',
  handed_off: 'Handed off',
};

const STAGE_TONE: Record<DispatchStage, string> = {
  created: 'border-amber-500/30 text-amber-700 bg-amber-500/10',
  packed: 'border-sky-500/30 text-sky-700 bg-sky-500/10',
  handed_off: 'border-emerald-500/30 text-emerald-700 bg-emerald-500/10',
};

const ADVANCE_LABEL: Partial<Record<DispatchStage, string>> = {
  created: 'Mark packed',
  packed: 'Mark handed off',
};

export function DispatchHistoryBlock({ dispatches }: Props) {
  if (dispatches.length === 0) {
    return (
      <div className="rounded-2xl border bg-muted/30 p-6 text-center space-y-1">
        <p className="text-sm font-medium">No dispatches yet</p>
        <p className="text-xs text-muted-foreground">
          Once you record a dispatch from the queue, it appears here with its
          lifecycle history.
        </p>
      </div>
    );
  }

  return (
    <ol className="space-y-3">
      {dispatches.map((d, idx) => (
        <DispatchCard key={d.dispatchId} entry={d} index={idx + 1} />
      ))}
    </ol>
  );
}

function DispatchCard({ entry, index }: { entry: DispatchEntry; index: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const mutation = useServerMutation(advanceDispatchStageAction, {
    successMessage: 'Stage updated',
    onSuccess: () => {
      router.refresh();
    },
    onError: (err) => {
      toast.error(err);
    },
    suppressErrorToast: true,
  });

  const next = NEXT_STAGE[entry.currentStage];
  const nextLabel = ADVANCE_LABEL[entry.currentStage];

  async function advance() {
    if (!next || mutation.isPending || pending) return;
    // The schema's enum is narrower than DispatchStage — only 'packed'
    // and 'handed_off' are valid advance targets (created is the initial
    // stage, never a destination). The runtime guard on `next` is
    // sufficient; TS just can't infer it from the Partial<Record>.
    if (next === 'created') return;
    setPending(true);
    try {
      await mutation.mutate({ dispatchId: entry.dispatchId, toStage: next });
    } finally {
      setPending(false);
    }
  }

  const created = new Date(entry.createdAtIso);
  return (
    <li className="rounded-2xl border bg-card px-4 py-3 space-y-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono text-muted-foreground">
            #{index}
          </span>
          <Badge
            variant="outline"
            className={cn('text-[10px]', STAGE_TONE[entry.currentStage])}
          >
            {STAGE_LABEL[entry.currentStage]}
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            {created.toLocaleString()}
          </span>
          {entry.dispatchedByName && (
            <span className="text-[11px] text-muted-foreground">
              · by {entry.dispatchedByName}
            </span>
          )}
        </div>
        {next && nextLabel && (
          <Button
            size="sm"
            variant="outline"
            onClick={advance}
            disabled={mutation.isPending || pending}
          >
            {mutation.isPending || pending ? (
              <>
                <Icon name="progress_activity" size="xs" className="animate-spin" />
                <span>Saving…</span>
              </>
            ) : (
              nextLabel
            )}
          </Button>
        )}
      </div>

      <ul className="space-y-1 text-sm pl-1">
        {entry.items.map((it) => (
          <li key={it.lineItemId} className="flex items-baseline justify-between gap-2">
            <span className="truncate">{it.productName}</span>
            <span className="font-mono text-xs text-muted-foreground">
              × {it.qty}
            </span>
          </li>
        ))}
      </ul>

      {entry.notes && (
        <p className="text-xs whitespace-pre-wrap text-foreground/80 bg-muted/40 rounded px-2 py-1">
          {entry.notes}
        </p>
      )}
    </li>
  );
}
