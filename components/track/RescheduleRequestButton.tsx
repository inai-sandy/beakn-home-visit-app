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

// =============================================================================
// HVA-72: customer-initiated reschedule on /track/[token]
// =============================================================================

interface Props {
  token: string;
  currentVisitScheduledAt: Date | null;
}

function toLocalDatetimeValue(d: Date | null): string {
  const fallback = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const v = d ?? fallback;
  return new Date(v.getTime() - v.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export function RescheduleRequestButton({
  token,
  currentVisitScheduledAt,
}: Props) {
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
    const target = new Date(when);
    if (Number.isNaN(target.getTime())) {
      toast.error('Pick a valid date + time');
      return;
    }
    if (target.getTime() <= Date.now()) {
      toast.error('Pick a date in the future');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/track/${encodeURIComponent(token)}/reschedule`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toVisitScheduledAt: target.toISOString(),
            reason: reason.trim() || undefined,
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        toast.error(data.error ?? 'Could not reschedule.');
        return;
      }
      toast.success('Visit rescheduled. Our team will confirm.');
      setOpen(false);
      startTransition(() => router.refresh());
    } catch {
      toast.error('Network error. Please try again.');
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
        className="h-10"
      >
        <Icon name="event_repeat" size="sm" />
        Reschedule visit
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reschedule your visit?</DialogTitle>
            <DialogDescription>
              Pick a date + time that works. Our team will confirm or reach
              out if there's a conflict.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="track-reschedule-when">
                New date + time <span className="text-destructive">*</span>
              </Label>
              <Input
                id="track-reschedule-when"
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                disabled={busy}
                className="h-11"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="track-reschedule-reason">
                Why?{' '}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="track-reschedule-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, 500))}
                maxLength={500}
                rows={3}
                disabled={busy}
                placeholder="A short note helps our team plan."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              Never mind
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
