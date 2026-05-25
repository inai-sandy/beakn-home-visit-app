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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { rescheduleByExecAction } from '@/lib/reschedule/actions';

// =============================================================================
// HVA-72: exec/admin Request Reschedule button + dialog
// =============================================================================

interface Props {
  requestId: string;
  currentVisitScheduledAt: Date | null;
}

function toLocalDatetimeValue(d: Date | null): string {
  if (!d) {
    const t = new Date(Date.now() + 60 * 60 * 1000);
    return new Date(t.getTime() - t.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  }
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export function RescheduleButton({ requestId, currentVisitScheduledAt }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState(() =>
    toLocalDatetimeValue(currentVisitScheduledAt),
  );
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  async function onSubmit() {
    if (busy) return;
    if (reason.trim().length < 10) {
      toast.error('Reason must be at least 10 characters');
      return;
    }
    const target = new Date(when);
    if (Number.isNaN(target.getTime())) {
      toast.error('Pick a valid date + time');
      return;
    }
    if (target.getTime() <= Date.now()) {
      toast.error('New date must be in the future');
      return;
    }
    setSubmitting(true);
    try {
      const res = await rescheduleByExecAction({
        requestId,
        toVisitScheduledAt: target.toISOString(),
        reason: reason.trim(),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success('Visit rescheduled');
      setOpen(false);
      startTransition(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
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
