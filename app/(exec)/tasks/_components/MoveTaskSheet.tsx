'use client';

import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useServerMutation } from '@/lib/hooks/use-server-mutation';

import { moveTaskAction } from '../../today/actions';

// =============================================================================
// HVA-170-FIX1: MoveTaskSheet — date-only sheet for pending/postponed move
// =============================================================================
//
// Replaces the clone-on-Pending/Postponed flow that produced duplicate
// rows. This sheet picks ONE field — the new date — and calls
// moveTaskAction. Status, link, description, type all stay untouched.
//
// Sheet title + button label vary by source status (D15):
//   - pending   → "Move task"      → "Move"
//   - postponed → "Reschedule task" → "Reschedule"
//
// Double-submit guard: useTransition + setSubmitting + busy flag. Submit
// button disabled when busy. Same guard pattern as AddTaskSheet.
// =============================================================================

const TASK_DATE_WINDOW_DAYS = 30;

function ymdFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function todayLocalIso(): string {
  return ymdFromDate(new Date());
}
function maxDateLocalIso(): string {
  const t = new Date();
  t.setDate(t.getDate() + TASK_DATE_WINDOW_DAYS);
  return ymdFromDate(t);
}

function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export interface MoveTarget {
  taskId: string;
  status: 'pending' | 'postponed';
  /** YYYY-MM-DD — task_date for pending, postponed_to_date for postponed. */
  currentDate: string;
  description: string;
}

interface Props {
  target: MoveTarget;
  onClose: () => void;
}

export function MoveTaskSheet({ target, onClose }: Props) {
  const minDate = useMemo(() => todayLocalIso(), []);
  const maxDate = useMemo(() => maxDateLocalIso(), []);

  const [newDate, setNewDate] = useState<string>(minDate);

  const isPostponed = target.status === 'postponed';
  const sheetTitle = isPostponed ? 'Reschedule task' : 'Move task';
  const buttonLabel = isPostponed ? 'Reschedule' : 'Move';
  const successCopy = isPostponed ? 'Task rescheduled' : 'Task moved';

  const { mutate, isPending: busy } = useServerMutation(moveTaskAction, {
    successMessage: successCopy,
    onSuccess: () => onClose(),
  });

  const canSubmit = !busy && newDate >= minDate && newDate <= maxDate;

  function onSubmit() {
    if (busy || !canSubmit) return;
    void mutate({
      taskId: target.taskId,
      newDate,
    });
  }

  return (
    <Sheet open onOpenChange={(o) => !o && !busy && onClose()}>
      <SheetContent side="bottom" className="max-h-[60svh]">
        <SheetHeader>
          <SheetTitle>{sheetTitle}</SheetTitle>
          <SheetDescription>
            Picks a new date for this task. Nothing else changes.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 space-y-4">
          <div className="rounded-lg border bg-muted/40 p-3 space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Task
            </p>
            <p className="text-sm font-medium leading-snug break-words">
              {target.description}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Currently: {formatDisplayDate(target.currentDate)}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="move-task-date" className="text-sm">
              New date <span className="text-destructive">*</span>
            </Label>
            <Input
              id="move-task-date"
              type="date"
              value={newDate}
              min={minDate}
              max={maxDate}
              onChange={(e) => setNewDate(e.target.value)}
              disabled={busy}
              className="h-11"
            />
          </div>
        </div>

        <SheetFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
          >
            {busy ? (
              <>
                <Icon
                  name="progress_activity"
                  size="sm"
                  className="animate-spin"
                />
                Saving…
              </>
            ) : (
              buttonLabel
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
