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
import { scheduleVisitAction } from '@/lib/visit-schedule/actions';
import { useServerMutation } from '@/lib/hooks/use-server-mutation';

// =============================================================================
// Schedule-Visit dialog — opens when advancing to VISIT_SCHEDULED
// =============================================================================

function defaultDatetimeValue(): string {
  // Default to tomorrow at 10:00 local time. Picker is editable.
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requestId: string;
}

export function ScheduleVisitDialog({ open, onOpenChange, requestId }: Props) {
  const [when, setWhen] = useState(() => defaultDatetimeValue());

  const { mutate, isPending } = useServerMutation(scheduleVisitAction, {
    successMessage: 'Visit scheduled — task created on the exec\'s plan',
    onSuccess: () => onOpenChange(false),
  });

  function onConfirm() {
    if (isPending) return;
    const target = new Date(when);
    if (Number.isNaN(target.getTime())) {
      toast.error('Pick a valid date + time');
      return;
    }
    if (target.getTime() <= Date.now()) {
      toast.error('Visit date must be in the future');
      return;
    }
    void mutate({ requestId, visitScheduledAt: target.toISOString() });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule the visit</DialogTitle>
          <DialogDescription>
            Pick a date + time for the home visit. Status moves to{' '}
            <strong>Visit Scheduled</strong>, a Customer-home-visit task
            lands on the exec's plan for that date, and the customer is
            notified.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="visit-schedule-when">
              Visit date + time <span className="text-destructive">*</span>
            </Label>
            <Input
              id="visit-schedule-when"
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              disabled={isPending}
              className="h-11"
            />
            <p className="text-[11px] text-muted-foreground">
              Customer + exec see this on their tracking page / calendar
              within seconds.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isPending}>
            {isPending ? (
              <>
                <Icon
                  name="progress_activity"
                  size="sm"
                  className="animate-spin"
                />
                Scheduling…
              </>
            ) : (
              'Schedule visit'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
