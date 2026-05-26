'use client';

import { useState } from 'react';
import { format, parseISO } from 'date-fns';

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
import {
  addExecUnavailabilityScheduleAction,
  removeExecUnavailabilityScheduleAction,
} from '@/lib/captain/availability-actions';
import { useServerMutation } from '@/lib/hooks/use-server-mutation';

// =============================================================================
// PR10 2026-05-26: scheduled exec unavailability — captain UI
// =============================================================================
//
// Lists today's + future windows for an exec and lets the captain
// add / remove. The boolean `is_unavailable` toggle stays separate
// (immediate flag for "out right now"); this section is the
// forward-dated planner.
//
// Lightweight inline UI — no separate sheet, the section lives in the
// drilldown page stack.
// =============================================================================

export interface ScheduleRowDTO {
  id: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  reason: string | null;
}

interface Props {
  execUserId: string;
  execName: string;
  schedules: ScheduleRowDTO[];
}

function fmtDate(iso: string): string {
  return format(parseISO(iso), 'EEE, dd MMM yyyy');
}

function tomorrowIso(): string {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  return format(t, 'yyyy-MM-dd');
}

export function UnavailabilityScheduleSection({
  execUserId,
  execName,
  schedules,
}: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [startDate, setStartDate] = useState(() => tomorrowIso());
  const [endDate, setEndDate] = useState(() => tomorrowIso());
  const [reason, setReason] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { mutate: addMutate, isPending: addBusy } = useServerMutation(
    addExecUnavailabilityScheduleAction,
    {
      successMessage: 'Unavailability scheduled',
      onSuccess: () => {
        setAddOpen(false);
        setStartDate(tomorrowIso());
        setEndDate(tomorrowIso());
        setReason('');
        setFieldErrors({});
      },
      onError: (_err, errs) => {
        if (errs) setFieldErrors(errs);
      },
    },
  );

  const { mutate: removeMutate, isPending: removeBusy } = useServerMutation(
    removeExecUnavailabilityScheduleAction,
    {
      successMessage: 'Schedule removed',
    },
  );

  function onAddSubmit() {
    if (addBusy) return;
    setFieldErrors({});
    void addMutate({
      execUserId,
      startDate,
      endDate,
      reason: reason.trim() || undefined,
    });
  }

  function onRemove(scheduleId: string) {
    if (removeBusy) return;
    void removeMutate({ execUserId, scheduleId });
  }

  return (
    <section
      aria-label="Scheduled unavailability"
      className="rounded-3xl border bg-card p-5 shadow-sm space-y-3"
    >
      <header className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Scheduled unavailability
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Date ranges {execName} won&apos;t be available. Use this for
            vacations, half-days, weekly offs. The immediate
            &ldquo;Mark unavailable&rdquo; toggle is separate.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setAddOpen(true)}
        >
          <Icon name="add" size="xs" />
          Add range
        </Button>
      </header>

      {schedules.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-3">
          No upcoming unavailability scheduled.
        </p>
      ) : (
        <ul className="space-y-2">
          {schedules.map((s) => {
            const sameDay = s.startDate === s.endDate;
            return (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-2xl border bg-muted/30 px-3 py-2"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-medium tracking-tight">
                    {sameDay
                      ? fmtDate(s.startDate)
                      : `${fmtDate(s.startDate)} → ${fmtDate(s.endDate)}`}
                  </p>
                  {s.reason && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {s.reason}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => onRemove(s.id)}
                  disabled={removeBusy}
                  className="text-destructive hover:bg-destructive/10"
                  aria-label="Remove schedule"
                >
                  <Icon name="close" size="xs" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={addOpen} onOpenChange={(o) => !addBusy && setAddOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add unavailability range</DialogTitle>
            <DialogDescription>
              Pick a start + end date (inclusive). Optionally add a short
              reason. Captain and the exec themselves see this on the
              exec drill-down.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="unavail-start">From</Label>
                <Input
                  id="unavail-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={addBusy}
                  className="h-11"
                />
                {fieldErrors.startDate && (
                  <p className="text-[11px] text-destructive">
                    {fieldErrors.startDate}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="unavail-end">To</Label>
                <Input
                  id="unavail-end"
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={addBusy}
                  className="h-11"
                />
                {fieldErrors.endDate && (
                  <p className="text-[11px] text-destructive">
                    {fieldErrors.endDate}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="unavail-reason">
                Reason{' '}
                <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="unavail-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, 200))}
                placeholder="e.g. Diwali vacation"
                disabled={addBusy}
                maxLength={200}
                rows={3}
              />
              <p className="text-[11px] text-muted-foreground">
                {reason.length} / 200
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddOpen(false)}
              disabled={addBusy}
            >
              Cancel
            </Button>
            <Button type="button" onClick={onAddSubmit} disabled={addBusy}>
              {addBusy ? (
                <>
                  <Icon
                    name="progress_activity"
                    size="sm"
                    className="animate-spin"
                  />
                  Saving…
                </>
              ) : (
                'Save range'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
