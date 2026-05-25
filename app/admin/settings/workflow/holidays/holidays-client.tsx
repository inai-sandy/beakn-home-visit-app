'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
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
import {
  createHolidayAction,
  updateHolidayAction,
  type CreateHolidayInput,
  type UpdateHolidayInput,
} from '@/lib/holidays/actions';

// =============================================================================
// HVA-93: HolidaysClient — admin list + create/edit modal
// =============================================================================

interface HolidayRow {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface FormState {
  mode: 'create' | { mode: 'edit'; id: string };
  name: string;
  date: string;
  isActive: boolean;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(): FormState {
  return { mode: 'create', name: '', date: todayIso(), isActive: true };
}

function formFromRow(row: HolidayRow): FormState {
  return {
    mode: { mode: 'edit', id: row.id },
    name: row.name,
    date: row.startDate,
    isActive: row.isActive,
  };
}

export function HolidaysClient({ holidays }: { holidays: HolidayRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  function openCreate() {
    setForm(emptyForm());
    setOpen(true);
  }

  function openEdit(row: HolidayRow) {
    setForm(formFromRow(row));
    setOpen(true);
  }

  async function onSubmit() {
    if (busy) return;
    if (form.name.trim().length < 2) {
      toast.error('Name must be at least 2 characters');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) {
      toast.error('Pick a valid date');
      return;
    }
    setSubmitting(true);
    try {
      const result =
        form.mode === 'create'
          ? await createHolidayAction({
              name: form.name.trim(),
              date: form.date,
            } satisfies CreateHolidayInput)
          : await updateHolidayAction({
              id: form.mode.id,
              name: form.name.trim(),
              date: form.date,
              isActive: form.isActive,
            } satisfies UpdateHolidayInput);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(form.mode === 'create' ? 'Holiday added' : 'Holiday updated');
      setOpen(false);
      startTransition(() => router.refresh());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {holidays.length} holiday{holidays.length === 1 ? '' : 's'}
        </p>
        <Button type="button" onClick={openCreate}>
          <Icon name="add" size="sm" />
          Add holiday
        </Button>
      </div>

      {holidays.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card/50 p-12 text-center">
          <Icon
            name="event"
            size="lg"
            className="text-muted-foreground/50 mx-auto mb-3"
            aria-hidden
          />
          <p className="text-sm text-muted-foreground">
            No holidays yet. Add Diwali, Republic Day, etc. so day-plan
            targets skip those dates.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {holidays.map((h) => {
            const d = new Date(h.startDate);
            const label = d.toLocaleDateString('en-IN', {
              weekday: 'short',
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            });
            return (
              <li
                key={h.id}
                className="rounded-2xl border bg-card p-4 shadow-sm flex items-center gap-3"
              >
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-base font-semibold tracking-tight">
                      {h.name}
                    </p>
                    {!h.isActive && (
                      <Badge variant="outline" className="text-[10px]">
                        Inactive
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => openEdit(h)}
                >
                  <Icon name="edit" size="xs" />
                  Edit
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {form.mode === 'create' ? 'Add a holiday' : 'Edit holiday'}
            </DialogTitle>
            <DialogDescription>
              Single-date holidays applies to all cities. Multi-day ranges
              and per-city scoping are coming later.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="holiday-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="holiday-name"
                value={form.name}
                onChange={(e) =>
                  setForm((s) => ({ ...s, name: e.target.value.slice(0, 255) }))
                }
                maxLength={255}
                disabled={busy}
                className="h-11"
                placeholder="e.g. Diwali"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="holiday-date">
                Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="holiday-date"
                type="date"
                value={form.date}
                onChange={(e) => setForm((s) => ({ ...s, date: e.target.value }))}
                disabled={busy}
                className="h-11"
              />
            </div>

            {form.mode !== 'create' && (
              <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
                <Label
                  htmlFor="holiday-active"
                  className="text-sm flex-1 cursor-pointer"
                >
                  Active — day-plan targets skip this date
                </Label>
                <input
                  id="holiday-active"
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, isActive: e.target.checked }))
                  }
                  disabled={busy}
                  className="h-4 w-4"
                />
              </div>
            )}
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
                  Saving…
                </>
              ) : form.mode === 'create' ? (
                'Add holiday'
              ) : (
                'Save'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
