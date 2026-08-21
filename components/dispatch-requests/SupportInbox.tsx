'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { OrderStatusBadge } from '@/components/dispatch-requests/RequestStatusBadge';
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
import { Textarea } from '@/components/ui/textarea';
import { decideDispatchRequestOrderAction } from '@/lib/dispatch-requests/actions';
import type { RequestDetailGroup } from '@/lib/dispatch-requests/queries';

// =============================================================================
// HVA-342: support decides one order at a time
// =============================================================================
//
// Per order, never per request. A request may span three customers and
// support will routinely have stock for one of them — forcing all-or-nothing
// would push them back to ringing the exec, which is the coordination this
// screen exists to remove.
//
// Dispatch is one tap: it writes the real shipment, so making support fill in
// a courier they have not booked yet would only teach them to type nonsense.
// Courier and tracking are added later through the existing dispatch record
// (HVA-303).
// =============================================================================

type PendingDecision = {
  group: RequestDetailGroup;
  decision: 'hold' | 'reject';
};

interface Props {
  groups: RequestDetailGroup[];
}

export function SupportInbox({ groups }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<PendingDecision | null>(null);
  const [reason, setReason] = useState('');

  function submit(
    group: RequestDetailGroup,
    decision: 'approve' | 'hold' | 'reject',
    reasonText?: string,
  ): void {
    setBusyGroupId(group.id);
    startTransition(async () => {
      const result = await decideDispatchRequestOrderAction({
        orderGroupId: group.id,
        decision,
        reason: reasonText,
      });
      setBusyGroupId(null);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        decision === 'approve'
          ? `Dispatched for ${group.customerName}`
          : decision === 'hold'
            ? 'Put on hold'
            : 'Declined',
      );
      setDialog(null);
      setReason('');
      router.refresh();
    });
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <Icon
          name="inbox"
          size="lg"
          className="text-muted-foreground"
          aria-hidden
        />
        <p className="mt-3 font-medium">Nothing waiting</p>
        <p className="mt-1 text-sm text-muted-foreground">
          No executive is waiting on a dispatch right now.
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-4">
        {groups.map((group) => {
          const live = group.items.filter((i) => i.cancelledAt === null);
          const busy = isPending && busyGroupId === group.id;
          return (
            <li
              key={group.id}
              className="rounded-lg border overflow-hidden"
            >
              <header className="flex items-start justify-between gap-3 bg-muted/40 px-4 py-3">
                <div className="min-w-0">
                  <h2 className="font-medium leading-tight">
                    {group.customerName}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {group.cityName}
                  </p>
                </div>
                <OrderStatusBadge status={group.status} />
              </header>

              <ul className="divide-y">
                {group.items.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-start justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p
                        className={
                          item.cancelledAt
                            ? 'line-through text-muted-foreground'
                            : ''
                        }
                      >
                        {item.productName}
                      </p>
                      {item.cancelledAt && (
                        <p className="mt-0.5 text-xs text-rose-700">
                          {item.cancelledReason ?? 'Cancelled'} — do not ship
                        </p>
                      )}
                    </div>
                    <span className="shrink-0 tabular-nums text-sm text-muted-foreground">
                      ×{item.quantity}
                    </span>
                  </li>
                ))}
              </ul>

              {group.status === 'held' && group.decisionReason && (
                <p className="border-t bg-amber-500/5 px-4 py-2 text-sm">
                  <span className="text-muted-foreground">On hold: </span>
                  {group.decisionReason}
                </p>
              )}

              <div className="flex flex-wrap gap-2 border-t px-4 py-3">
                <Button
                  size="sm"
                  disabled={busy || live.length === 0}
                  onClick={() => submit(group, 'approve')}
                >
                  {busy ? 'Working…' : 'Dispatch'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setReason('');
                    setDialog({ group, decision: 'hold' });
                  }}
                >
                  Put on hold
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setReason('');
                    setDialog({ group, decision: 'reject' });
                  }}
                >
                  Decline
                </Button>
                {live.length === 0 && (
                  <p className="w-full text-xs text-rose-700">
                    Every product here was removed from the order in CartPlus.
                    Decline it — there is nothing left to ship.
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
            setReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog?.decision === 'hold'
                ? 'Put on hold'
                : 'Decline this request'}
            </DialogTitle>
            <DialogDescription>
              {dialog?.decision === 'hold'
                ? 'The executive will see this and can tell the customer what to expect.'
                : 'The executive will see this instead of chasing you for an answer.'}
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label htmlFor="decision-reason">Reason</Label>
            <Textarea
              id="decision-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="mt-1"
              placeholder={
                dialog?.decision === 'hold'
                  ? 'e.g. out of stock until Friday'
                  : 'e.g. product discontinued'
              }
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              disabled={isPending || reason.trim().length === 0}
              onClick={() => {
                if (!dialog) return;
                submit(dialog.group, dialog.decision, reason.trim());
              }}
            >
              {isPending ? 'Saving…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
