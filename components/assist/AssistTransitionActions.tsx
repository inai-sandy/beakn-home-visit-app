'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
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
import { transitionAssistStatusAction } from '@/lib/assist/actions';
import {
  allowedNextStatuses,
  type AssistStatus,
} from '@/lib/assist/types';

// HVA-199: captain + admin action bar on the detail page.
//
// Four buttons (per HVA-197 alignment rule: h-12 px-5 text-base font-medium):
//   Reject (destructive outline)
//   Approve / Mark processing / Mark dispatched (one of the three, depending
//   on current status; primary-styled).
//
// Only renders the buttons legal for the current status. Reject opens a
// modal for an optional reason; the forward action fires inline.

interface Props {
  assistId: string;
  status: AssistStatus;
}

export function AssistTransitionActions({ assistId, status }: Props) {
  const router = useRouter();
  const next = allowedNextStatuses(status);
  const [isPending, startTransition] = useTransition();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  if (next.length === 0) return null;

  const forward = next.find((s) => s !== 'rejected');
  const canReject = next.includes('rejected');

  function transition(toStatus: AssistStatus, reason: string | null) {
    startTransition(async () => {
      const result = await transitionAssistStatusAction({
        assistId,
        toStatus,
        reason,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Status updated');
      setRejectOpen(false);
      setRejectReason('');
      router.refresh();
    });
  }

  const forwardLabel: Record<AssistStatus, string> = {
    submitted: '',
    approved: 'Approve',
    processing: 'Mark processing',
    dispatched: 'Mark dispatched',
    rejected: 'Reject',
  };

  return (
    <>
      <section className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 flex-wrap">
        {canReject && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setRejectOpen(true)}
            disabled={isPending}
            className="w-full sm:w-auto h-12 px-5 text-base font-medium border-destructive/60 text-destructive hover:bg-destructive/10"
          >
            <Icon name="cancel" size="sm" />
            <span>Reject</span>
          </Button>
        )}
        {forward && (
          <Button
            type="button"
            onClick={() => transition(forward, null)}
            disabled={isPending}
            className="w-full sm:w-auto h-12 px-5 text-base font-medium"
          >
            <Icon
              name={
                forward === 'approved'
                  ? 'check_circle'
                  : forward === 'processing'
                    ? 'sync'
                    : 'local_shipping'
              }
              size="sm"
            />
            <span>{forwardLabel[forward]}</span>
          </Button>
        )}
      </section>

      <Dialog open={rejectOpen} onOpenChange={(o) => !isPending && setRejectOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this assist?</DialogTitle>
            <DialogDescription>
              The exec will be notified. Adding a reason helps them understand
              what went wrong (optional).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="reject-reason" className="text-xs text-muted-foreground">
              Reason (optional)
            </Label>
            <textarea
              id="reject-reason"
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Item unavailable until next quarter"
              className="w-full rounded-md border bg-background p-3 text-sm"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRejectOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => transition('rejected', rejectReason.trim() || null)}
              disabled={isPending}
            >
              {isPending ? 'Rejecting…' : 'Confirm reject'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
