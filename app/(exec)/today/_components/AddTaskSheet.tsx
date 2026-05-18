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
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { addTaskAction } from '../actions';

// =============================================================================
// HVA-58 / HVA-60 D: AddTaskSheet — fixed FAB + bottom sheet
// =============================================================================
//
// Field shape per spec §10.3 (with Δ4 deviation noted):
//   1. Task Type — chips, single-select, 7 options (the pgEnum values
//      verbatim per Δ2).
//   2. Description — text input, required, 5–200 chars.
//   3. Link to Request — optional, client-side search over the exec's
//      assignments (rows passed from server).
//   4. Estimated time — REQUIRED dropdown (Δ4 — schema is NOT NULL, bundle
//      said "optional"; using path (a): require with default '30min').
//
// After Add: revalidatePath fires server-side, router.refresh updates
// the page-level RSC, sheet closes, toast shows.
// =============================================================================

const TASK_TYPES = [
  'Outlet visit',
  'Customer home visit',
  'Sales pitch',
  'Follow-up',
  'Installation & Activation',
  'Stall Activity',
  'Other',
] as const;

const ESTIMATED_TIMES = ['15min', '30min', '1hr', '2hr', '3hr+'] as const;

interface Props {
  trigger?: React.ReactNode;
  linkableRequests: Array<{
    id: string;
    customerName: string;
    customerPhone: string;
  }>;
  /** When true, FAB renders disabled (read-only state — day closed). */
  disabled?: boolean;
  /**
   * When true, the Close-the-Day strip is rendered on the page. The FAB
   * shifts higher to clear that strip on mobile. Bug 5/6 (HVA-60 walk)
   * relocated the strip to `bottom-16`; the FAB needs to sit above it.
   */
  closeButtonVisible?: boolean;
}

export function AddTaskFab({
  linkableRequests,
  disabled = false,
  closeButtonVisible = false,
}: Props) {
  const [open, setOpen] = useState(false);
  // Bug 10 walk fix: the FAB was covered by the Close strip on desktop
  // (and on mobile when closeButtonVisible). The strip is z-40 at
  // md:bottom-4 right-4 max-w-sm; the FAB was z-30 at md:bottom-6
  // right-4 — same corner, lower z, covered.
  //
  // Two correct fixes available: (1) raise FAB z-index above the strip,
  // (2) move FAB above the strip vertically. (2) is the right call —
  // a stacking z-order on the same corner makes the strip uninteractable.
  // The strip is fixed-height: mobile ~5rem (bottom-16 → top edge at
  // bottom-21), desktop ~4rem (bottom-4 → top edge at bottom-8).
  //
  // closeButtonVisible OFF → FAB at default offsets:
  //   mobile bottom-20 (above the bottom-nav h-16)
  //   desktop md:bottom-6 (corner)
  // closeButtonVisible ON → FAB shifts above the strip:
  //   mobile bottom-40
  //   desktop md:bottom-24 (clear of the strip top edge at bottom-8)
  const bottomClasses = closeButtonVisible
    ? 'bottom-40 md:bottom-24'
    : 'bottom-20 md:bottom-6';
  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        size="lg"
        className={`fixed ${bottomClasses} right-4 z-30 h-14 w-14 rounded-full shadow-lg`}
        aria-label="Add task"
      >
        <Icon name="add" size="md" />
      </Button>
      {open && (
        <AddTaskSheet
          linkableRequests={linkableRequests}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function AddTaskSheet({
  linkableRequests,
  onClose,
}: {
  linkableRequests: Props['linkableRequests'];
  onClose: () => void;
}) {
  const router = useRouter();
  const [taskType, setTaskType] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [estimatedTime, setEstimatedTime] = useState<string>('30min');
  const [linkSearch, setLinkSearch] = useState('');
  const [linkRequestId, setLinkRequestId] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  // Client-side filter over the exec's own assignments. Top 5 by recency
  // are passed in already-ordered; this just narrows by free-text match.
  const matchingRequests = useMemo(() => {
    const q = linkSearch.trim().toLowerCase();
    if (q === '') return linkableRequests.slice(0, 5);
    const needleDigits = q.replace(/\D/g, '');
    return linkableRequests
      .filter((r) => {
        if (r.customerName.toLowerCase().includes(q)) return true;
        if (
          needleDigits.length > 0 &&
          r.customerPhone.replace(/\D/g, '').includes(needleDigits)
        ) {
          return true;
        }
        return false;
      })
      .slice(0, 5);
  }, [linkSearch, linkableRequests]);

  const canSubmit =
    !busy &&
    taskType !== null &&
    description.trim().length >= 5 &&
    description.trim().length <= 200 &&
    ESTIMATED_TIMES.includes(estimatedTime as (typeof ESTIMATED_TIMES)[number]);

  async function onSubmit() {
    if (!canSubmit || taskType === null) return;
    setSubmitting(true);
    try {
      const result = await addTaskAction({
        taskType,
        description: description.trim(),
        estimatedTime,
        linkRequestId: linkRequestId ?? null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Task added');
      onClose();
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[90svh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add a task</SheetTitle>
          <SheetDescription>
            Anything you want to do today that wasn&apos;t already on the plan.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 space-y-5">
          <div className="space-y-2">
            <Label className="text-sm">
              Task type <span className="text-destructive">*</span>
            </Label>
            <div className="flex flex-wrap gap-2">
              {TASK_TYPES.map((t) => (
                <Button
                  key={t}
                  type="button"
                  size="sm"
                  variant={taskType === t ? 'default' : 'outline'}
                  className="rounded-full"
                  onClick={() => setTaskType(t)}
                  disabled={busy}
                >
                  {t}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-task-description" className="text-sm">
              Description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="add-task-description"
              placeholder="What needs to happen?"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 200))}
              rows={2}
              maxLength={200}
              disabled={busy}
            />
            <p className="text-[11px] text-muted-foreground">
              {description.trim().length}/200
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-task-est" className="text-sm">
              Estimated time <span className="text-destructive">*</span>
            </Label>
            <Select
              value={estimatedTime}
              onValueChange={setEstimatedTime}
              disabled={busy}
            >
              <SelectTrigger id="add-task-est" className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ESTIMATED_TIMES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-task-link" className="text-sm">
              Link to a request{' '}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="add-task-link"
              type="search"
              placeholder="Search your assigned requests…"
              value={linkSearch}
              onChange={(e) => {
                setLinkSearch(e.target.value);
                setLinkRequestId(null);
              }}
              disabled={busy}
              className="h-11"
            />
            {linkSearch.trim() !== '' && (
              <ul className="rounded-md border bg-background divide-y">
                {matchingRequests.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-muted-foreground">
                    No matches.
                  </li>
                ) : (
                  matchingRequests.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setLinkRequestId(r.id);
                          setLinkSearch(r.customerName);
                        }}
                        disabled={busy}
                        className="w-full text-left px-3 py-2 hover:bg-muted text-sm flex items-center justify-between gap-2"
                      >
                        <span>{r.customerName}</span>
                        <span className="text-xs text-muted-foreground font-mono">
                          {r.customerPhone}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
            {linkRequestId && (
              <p className="text-[11px] text-primary">
                Linked to selected request.
              </p>
            )}
          </div>
        </div>

        <SheetFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={onSubmit} disabled={!canSubmit}>
            {busy ? (
              <>
                <Icon name="progress_activity" size="sm" className="animate-spin" />
                Saving…
              </>
            ) : (
              'Add task'
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
