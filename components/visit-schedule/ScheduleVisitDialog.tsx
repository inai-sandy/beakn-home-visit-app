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
  // HVA-253: dialog now serves every transition with requires_datetime=true,
  // not just VISIT_SCHEDULED. Caller passes the target stage so the action
  // can look up the transition row + the right auto-task type.
  nextStatus: { id: string; code: string; name: string };
}

// HVA-253: copy adapts to the destination stage. Add more cases here as
// new transitions opt into the calendar picker.
function copyForStage(code: string, name: string): {
  title: string;
  description: string;
  confirmLabel: string;
  successMessage: string;
} {
  if (code === 'VISIT_SCHEDULED') {
    return {
      title: 'Schedule the visit',
      description:
        'Pick a date + time for the home visit. Status moves to Visit Scheduled, a Customer-home-visit task lands on the exec’s plan, and the customer is notified.',
      confirmLabel: 'Schedule visit',
      successMessage: 'Visit scheduled — task created on the exec’s plan',
    };
  }
  if (code === 'INSTALLATION_SCHEDULED') {
    return {
      title: 'Schedule the installation',
      description:
        'Pick a date + time for the installation. Status moves to Installation Scheduled and an Installation & Activation task lands on the exec’s plan for that day.',
      confirmLabel: 'Schedule installation',
      successMessage:
        'Installation scheduled — task created on the exec’s plan',
    };
  }
  return {
    title: `Schedule ${name}`,
    description: `Pick a date + time. The request moves to ${name} and an auto-task lands on the exec’s plan for that day.`,
    confirmLabel: `Schedule ${name.toLowerCase()}`,
    successMessage: `${name} scheduled — task created on the exec’s plan`,
  };
}

export function ScheduleVisitDialog({
  open,
  onOpenChange,
  requestId,
  nextStatus,
}: Props) {
  const [when, setWhen] = useState(() => defaultDatetimeValue());
  const copy = copyForStage(nextStatus.code, nextStatus.name);

  const { mutate, isPending } = useServerMutation(scheduleVisitAction, {
    successMessage: copy.successMessage,
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
      toast.error('Scheduled date must be in the future');
      return;
    }
    void mutate({
      requestId,
      nextStatusId: nextStatus.id,
      visitScheduledAt: target.toISOString(),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !isPending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="visit-schedule-when">
              Date + time <span className="text-destructive">*</span>
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
              Exec + customer see this on their plan / tracking page within
              seconds.
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
              copy.confirmLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
