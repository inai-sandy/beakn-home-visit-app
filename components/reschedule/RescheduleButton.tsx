'use client';

import { useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useServerMutation } from '@/lib/hooks/use-server-mutation';
import { rescheduleByExecAction } from '@/lib/reschedule/actions';

// =============================================================================
// HVA-72: exec/admin Request Reschedule button + dialog
// =============================================================================

interface Props {
  requestId: string;
  currentVisitScheduledAt: Date | null;
}

// 2026-05-26 IST tz fix: this runs on the SERVER for the initial render of
// the dialog defaults (and on the CLIENT in IST browsers). On the server
// the container is UTC, so .getTimezoneOffset() returns 0 and the old
// code emitted UTC time. For a visit at 12:00 PM IST (06:30 UTC) that
// rendered "06:30" in the datetime-local field — wrong. We force the
// IST offset (+05:30 = -330 min) so the string matches what the user
// picked regardless of where this runs.
const IST_OFFSET_MIN = 330;
function toLocalDatetimeValue(d: Date | null): string {
  const base = d ?? new Date(Date.now() + 60 * 60 * 1000);
  return new Date(base.getTime() + IST_OFFSET_MIN * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function RescheduleButton({ requestId, currentVisitScheduledAt }: Props) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState(() =>
    toLocalDatetimeValue(currentVisitScheduledAt),
  );
  const [reason, setReason] = useState('');

  // HVA-149: useServerMutation bundles useTransition + router.refresh() +
  // toasts so a forgotten refresh can't recur here.
  const { mutate, isPending: busy } = useServerMutation(rescheduleByExecAction, {
    successMessage: 'Visit rescheduled',
    onSuccess: () => setOpen(false),
  });

  function onSubmit() {
    if (busy) return;
    if (reason.trim().length < 10) {
      toast.error('Reason must be at least 10 characters');
      return;
    }
    // The datetime-local value is naked (no tz suffix). Treat the entered
    // value as IST and convert to UTC by adding the +05:30 offset before
    // sending. Without this, server-side new Date(when) interprets the
    // string as UTC and stores a time 5:30 earlier than the user picked.
    const targetUtcMs = Date.parse(`${when}:00.000+05:30`);
    if (Number.isNaN(targetUtcMs)) {
      toast.error('Pick a valid date + time');
      return;
    }
    if (targetUtcMs <= Date.now()) {
      toast.error('New date must be in the future');
      return;
    }
    void mutate({
      requestId,
      toVisitScheduledAt: new Date(targetUtcMs).toISOString(),
      reason: reason.trim(),
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setWhen(toLocalDatetimeValue(currentVisitScheduledAt));
          setReason('');
          setOpen(true);
        }}
      >
        <Icon name="event_repeat" size="sm" />
        Reschedule visit
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reschedule visit</DialogTitle>
            <DialogDescription>
              Pick a new date + time. Customer is notified automatically.
              Adds a row to the reschedule history.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reschedule-when">
                New date + time <span className="text-destructive">*</span>
              </Label>
              <Input
                id="reschedule-when"
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                disabled={busy}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reschedule-reason">
                Reason <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="reschedule-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, 500))}
                maxLength={500}
                rows={3}
                disabled={busy}
                placeholder="e.g. Customer asked to push by two days"
              />
              <p className="text-[11px] text-muted-foreground">
                {reason.length} / 500 — minimum 10 chars
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="button" onClick={onSubmit} disabled={busy}>
              {busy ? (
                <>
                  <Icon
                    name="progress_activity"
                    size="sm"
                    className="animate-spin"
                  />
                  Rescheduling…
                </>
              ) : (
                'Reschedule'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
