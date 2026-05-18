'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

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
import { Switch } from '@/components/ui/switch';

import { postponeTaskAction } from '../actions';

// =============================================================================
// HVA-60 F: PostponeSheet
// =============================================================================
//
// Bottom sheet with all three spec §10.6 sections visible at once:
//   1. Reason chips (single-select)
//   2. New date picker (default tomorrow IST, min today, max today+30)
//   3. Customer informed toggle (default No)
//
// On Confirm, if customer_informed is false, surface a secondary snackbar
// with Send / Skip actions. Send is wired as a console.log stub until
// the WhatsApp send module (HVA-45/46) ships. Postpone confirmation does
// NOT block on WhatsApp readiness — the row is already updated by the
// time the snackbar appears.
// =============================================================================

function tomorrowIso(): string {
  const t = new Date();
  t.setDate(t.getDate() + 1);
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayIso(): string {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function maxDateIso(): string {
  const t = new Date();
  t.setDate(t.getDate() + 30);
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

interface Props {
  taskId: string;
  reasons: Array<{ id: string; code: string; name: string }>;
  onClose: () => void;
}

export function PostponeSheet({ taskId, reasons, onClose }: Props) {
  const router = useRouter();
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [date, setDate] = useState<string>(tomorrowIso());
  const [customerInformed, setCustomerInformed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  const today = useMemo(() => todayIso(), []);
  const max = useMemo(() => maxDateIso(), []);

  async function onConfirm() {
    if (busy) return;
    if (!reasonId) {
      toast.error('Pick a reason');
      return;
    }
    setSubmitting(true);
    try {
      const result = await postponeTaskAction({
        taskId,
        reasonId,
        postponedToDate: date,
        customerInformed,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onClose();
      startTransition(() => {
        router.refresh();
      });
      if (!customerInformed) {
        toast('Send notification to customer now?', {
          duration: 8000,
          action: {
            label: 'Send',
            onClick: () => {
              // HVA-45/46 stub. lib/whatsapp.ts will replace this once
              // the sender module lands. Postpone is already persisted
              // by this point — Send is best-effort.
              // eslint-disable-next-line no-console
              console.log(
                '[postpone] TODO HVA-45/46: send WhatsApp notification for task',
                taskId,
              );
              toast.success('Notification queued (stub)');
            },
          },
          cancel: { label: 'Skip', onClick: () => undefined },
        });
      } else {
        toast.success('Task postponed');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[90svh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Postpone task</SheetTitle>
          <SheetDescription>
            Pick a reason, choose a new date, and note whether the customer
            has been informed.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 space-y-5">
          <div className="space-y-2">
            <Label className="text-sm">
              Reason <span className="text-destructive">*</span>
            </Label>
            <div className="flex flex-wrap gap-2">
              {reasons.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No postpone reasons configured. Ask an admin to seed them.
                </p>
              ) : (
                reasons.map((r) => (
                  <Button
                    key={r.id}
                    type="button"
                    size="sm"
                    variant={reasonId === r.id ? 'default' : 'outline'}
                    className="rounded-full"
                    onClick={() => setReasonId(r.id)}
                    disabled={busy}
                  >
                    {r.name}
                  </Button>
                ))
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="postpone-date" className="text-sm">
              New date <span className="text-destructive">*</span>
            </Label>
            <Input
              id="postpone-date"
              type="date"
              value={date}
              min={today}
              max={max}
              onChange={(e) => setDate(e.target.value)}
              disabled={busy}
              className="h-11"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="customer-informed" className="text-sm">
              Was the customer informed?
            </Label>
            <Switch
              id="customer-informed"
              checked={customerInformed}
              onCheckedChange={setCustomerInformed}
              disabled={busy}
            />
          </div>
        </div>

        <SheetFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={busy || !reasonId}>
            {busy ? (
              <>
                <Icon name="progress_activity" size="sm" className="animate-spin" />
                Saving…
              </>
            ) : (
              'Confirm postpone'
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
