'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  bulkReassignAffectedVisitsAction,
  type AffectedVisitRow,
} from '@/lib/captain/rebalance-actions';

// =============================================================================
// HVA-85: rebalance dialog — picks new exec per affected future visit
// =============================================================================

interface Teammate {
  id: string;
  fullName: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  fromExecUserId: string;
  fromExecName: string;
  visits: AffectedVisitRow[];
  teammates: Teammate[];
}

export function RebalanceDialog({
  open,
  onClose,
  fromExecUserId,
  fromExecName,
  visits,
  teammates,
}: Props) {
  const router = useRouter();
  const [assignments, setAssignments] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      visits.map((v) => [v.requestId, teammates[0]?.id ?? '']),
    ),
  );
  const [reason, setReason] = useState(
    `${fromExecName} marked unavailable — bulk reassign by captain.`,
  );
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  async function onConfirm() {
    if (busy) return;
    if (reason.trim().length < 20) {
      toast.error('Reason must be at least 20 characters');
      return;
    }
    const reassignments = visits
      .map((v) => ({
        requestId: v.requestId,
        toExecUserId: assignments[v.requestId] ?? '',
      }))
      .filter((r) => r.toExecUserId.length > 0);
    if (reassignments.length === 0) {
      toast.error('Pick a destination exec for each visit');
      return;
    }

    setSubmitting(true);
    try {
      const res = await bulkReassignAffectedVisitsAction({
        fromExecUserId,
        reassignments,
        reason: reason.trim(),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Reassigned ${res.data?.reassignedCount ?? reassignments.length} visit${(res.data?.reassignedCount ?? reassignments.length) === 1 ? '' : 's'}`,
      );
      onClose();
      startTransition(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reassign affected visits?</DialogTitle>
          <DialogDescription>
            {fromExecName} has {visits.length} scheduled visit
            {visits.length === 1 ? '' : 's'} coming up. Pick a teammate for
            each — they take over without breaking the request thread.
          </DialogDescription>
        </DialogHeader>

        {teammates.length === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            No other active execs on this team. Mark one as available before
            redistributing, or handle these visits another way.
          </div>
        ) : (
          <div className="space-y-3">
            <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {visits.map((v) => (
                <li
                  key={v.requestId}
                  className="rounded-lg border bg-card/50 p-2.5 space-y-1.5"
                >
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <p className="text-sm font-medium tracking-tight">
                      {v.customerName}
                    </p>
                    {v.visitScheduledAt && (
                      <p className="text-[11px] text-muted-foreground">
                        {v.visitScheduledAt.toLocaleString('en-IN', {
                          weekday: 'short',
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    )}
                  </div>
                  <Select
                    value={assignments[v.requestId] ?? ''}
                    onValueChange={(value) =>
                      setAssignments((s) => ({ ...s, [v.requestId]: value }))
                    }
                    disabled={busy}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Pick an exec" />
                    </SelectTrigger>
                    <SelectContent>
                      {teammates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.fullName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>

            <div className="space-y-1.5">
              <Label htmlFor="rebalance-reason">
                Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="rebalance-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, 500))}
                maxLength={500}
                rows={2}
                disabled={busy}
              />
              <p className="text-[11px] text-muted-foreground">
                Minimum 20 characters. Stored on each reassignment for audit.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Skip for now
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={busy || teammates.length === 0}
          >
            {busy ? (
              <>
                <Icon
                  name="progress_activity"
                  size="sm"
                  className="animate-spin"
                />
                Reassigning…
              </>
            ) : (
              `Reassign ${visits.length} visit${visits.length === 1 ? '' : 's'}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
