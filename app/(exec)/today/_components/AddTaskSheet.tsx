'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
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
import { cn } from '@/lib/utils';

import { addTaskAction, editTaskAction } from '../actions';

// =============================================================================
// HVA-58 / HVA-60 / HVA-73 followup: AddTaskSheet
// =============================================================================
//
// Two modes:
//
//   1. Open  — link search shows two grouped sections (Leads / Requests);
//              exec picks one or leaves unlinked. Used by /today FAB.
//
//   2. Preselected — caller passes `preselectedLink`; the link section is
//              a non-editable chip showing what's already chosen. Used by
//              the lead-detail "Create Task in Day Sheet" button.
//
// XOR rule (HVA-73 followup): linkRequestId and linkLeadId are mutually
// exclusive. Server enforces this in addTaskAction; this component
// guarantees it by only ever holding one of the two IDs in state.
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

const TASK_DATE_WINDOW_DAYS = 30;

// Local YYYY-MM-DD helpers. We deliberately use the browser's local
// calendar here — the device shipping the form is the source of truth
// for what "today" feels like to the user. Server re-clamps against IST.
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

export interface LinkableRequest {
  id: string;
  customerName: string;
  customerPhone: string;
}

export interface LinkableLead {
  id: string;
  name: string;
  phone: string;
}

export interface PreselectedLink {
  type: 'lead' | 'request';
  id: string;
  displayLabel: string;
}

/**
 * HVA-159: when supplied, AddTaskSheet renders in edit mode (title /
 * submit button copy + prefilled form / editTaskAction call). The
 * Task type is NOT in the editable set so we omit it from the prefill —
 * the field stays disabled (greyed out) since it's immutable on edit.
 */
export interface TaskToEdit {
  id: string;
  taskType: string;
  description: string;
  estimatedTime: string;
  taskDate: string;
  linkRequestId: string | null;
  linkLeadId: string | null;
}

/**
 * HVA-170 D5: when supplied (and `taskToEdit` is absent), AddTaskSheet
 * renders in clone mode — same form fields as add mode pre-filled from
 * the source task, but submits a NEW row via addTaskAction. taskDate
 * intentionally NOT in this shape — clone always defaults to today
 * per D7. Task type chip stays editable; user may want to log a
 * follow-up of a different type.
 */
export interface CloneFromTask {
  taskType: string;
  description: string;
  estimatedTime: string;
  linkRequestId: string | null;
  linkLeadId: string | null;
}

interface Props {
  trigger?: React.ReactNode;
  linkableRequests: LinkableRequest[];
  linkableLeads?: LinkableLead[];
  /** When true, FAB renders disabled (read-only state — day closed). */
  disabled?: boolean;
}

// HVA-60 design polish (Change A): AddTaskFab no longer owns its own
// positioning. The parent <BottomActions> wrapper in PostSubmissionView
// renders this FAB alongside the optional Close-the-Day button in the
// bottom-right corner.
export function AddTaskFab({
  linkableRequests,
  linkableLeads = [],
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        size="lg"
        className="h-14 w-14 rounded-full shadow-lg"
        aria-label="Add task"
      >
        <Icon name="add" size="md" />
      </Button>
      {open && (
        <AddTaskSheet
          linkableRequests={linkableRequests}
          linkableLeads={linkableLeads}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// =============================================================================
// AddTaskSheet — exported so the lead-detail page can open it directly
// with a preselectedLink.
// =============================================================================

export function AddTaskSheet({
  linkableRequests,
  linkableLeads = [],
  preselectedLink,
  taskToEdit,
  cloneFromTask,
  onClose,
}: {
  linkableRequests: LinkableRequest[];
  linkableLeads?: LinkableLead[];
  preselectedLink?: PreselectedLink;
  /** HVA-159: when present, renders in edit mode and calls editTaskAction. */
  taskToEdit?: TaskToEdit;
  /** HVA-170 D5: when present (and taskToEdit absent), renders in clone
   *  mode — prefills from source but submits a NEW row via addTaskAction. */
  cloneFromTask?: CloneFromTask;
  onClose: () => void;
}) {
  const router = useRouter();
  const editMode = Boolean(taskToEdit);
  const cloneMode = !editMode && Boolean(cloneFromTask);
  const [taskType, setTaskType] = useState<string | null>(
    taskToEdit?.taskType ?? cloneFromTask?.taskType ?? null,
  );
  // taskDate: edit mode keeps the row's date; clone mode + add mode default
  // to today (D7 — clone never inherits source's date).
  const [taskDate, setTaskDate] = useState<string>(
    taskToEdit?.taskDate ?? todayLocalIso(),
  );
  const [description, setDescription] = useState(
    taskToEdit?.description ?? cloneFromTask?.description ?? '',
  );
  const [estimatedTime, setEstimatedTime] = useState<string>(
    taskToEdit?.estimatedTime ?? cloneFromTask?.estimatedTime ?? '30min',
  );
  const [linkSearch, setLinkSearch] = useState('');
  const [linkRequestId, setLinkRequestId] = useState<string | null>(
    taskToEdit?.linkRequestId ?? cloneFromTask?.linkRequestId ?? null,
  );
  const [linkLeadId, setLinkLeadId] = useState<string | null>(
    taskToEdit?.linkLeadId ?? cloneFromTask?.linkLeadId ?? null,
  );

  // Memoised so the min/max stay stable for the lifetime of an open sheet.
  // Long enough to be irrelevant in practice; right thing to do anyway.
  const minDate = useMemo(() => todayLocalIso(), []);
  const maxDate = useMemo(() => maxDateLocalIso(), []);
  const isFutureDate = taskDate > minDate;

  useEffect(() => {
    if (preselectedLink?.type === 'lead') setLinkLeadId(preselectedLink.id);
    if (preselectedLink?.type === 'request') setLinkRequestId(preselectedLink.id);
  }, [preselectedLink]);

  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  const grouped = useMemo(() => {
    const q = linkSearch.trim().toLowerCase();
    if (q === '') {
      return {
        leads: linkableLeads.slice(0, 5),
        requests: linkableRequests.slice(0, 5),
      };
    }
    const needleDigits = q.replace(/\D/g, '');
    const matchPhone = (phone: string) =>
      needleDigits.length > 0 && phone.replace(/\D/g, '').includes(needleDigits);
    const leads = linkableLeads
      .filter((l) => l.name.toLowerCase().includes(q) || matchPhone(l.phone))
      .slice(0, 5);
    const requests = linkableRequests
      .filter(
        (r) => r.customerName.toLowerCase().includes(q) || matchPhone(r.customerPhone),
      )
      .slice(0, 5);
    return { leads, requests };
  }, [linkSearch, linkableLeads, linkableRequests]);

  const canSubmit =
    !busy &&
    taskType !== null &&
    description.trim().length >= 5 &&
    description.trim().length <= 200 &&
    ESTIMATED_TIMES.includes(estimatedTime as (typeof ESTIMATED_TIMES)[number]) &&
    taskDate >= minDate &&
    taskDate <= maxDate;

  async function onSubmit() {
    if (!canSubmit || taskType === null) return;
    setSubmitting(true);
    try {
      const result = editMode && taskToEdit
        ? await editTaskAction({
            taskId: taskToEdit.id,
            description: description.trim(),
            taskDate,
            estimatedTime,
            linkRequestId: linkRequestId ?? null,
            linkLeadId: linkLeadId ?? null,
          })
        : await addTaskAction({
            taskType,
            description: description.trim(),
            estimatedTime,
            taskDate,
            linkRequestId: linkRequestId ?? null,
            linkLeadId: linkLeadId ?? null,
          });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        editMode ? 'Task updated' : cloneMode ? 'Task re-added' : 'Task added',
      );
      onClose();
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setSubmitting(false);
    }
  }

  function clearLink() {
    setLinkRequestId(null);
    setLinkLeadId(null);
    setLinkSearch('');
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[90svh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {editMode
              ? 'Edit task'
              : cloneMode
                ? 'Re-add task'
                : 'Add a task'}
          </SheetTitle>
          <SheetDescription>
            {editMode
              ? 'Update the description, date, or link. Task type stays the same.'
              : cloneMode
                ? 'Pre-filled from the original. Date defaults to today.'
                : "Anything you want to do today that wasn't already on the plan."}
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
                  disabled={busy || editMode}
                >
                  {t}
                </Button>
              ))}
            </div>
            {editMode && (
              <p className="text-[11px] text-muted-foreground">
                Task type cannot be changed.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="add-task-date" className="text-sm">
              Task date <span className="text-destructive">*</span>
            </Label>
            <Input
              id="add-task-date"
              type="date"
              value={taskDate}
              min={minDate}
              max={maxDate}
              onChange={(e) => setTaskDate(e.target.value)}
              disabled={busy}
              className="h-11"
            />
            {isFutureDate && (
              <p className="text-[11px] text-muted-foreground">
                Scheduled for a future day — it won&apos;t appear on Today
                until then.
              </p>
            )}
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

          {/* Link to request OR lead */}
          <div className="space-y-2">
            <Label htmlFor="add-task-link" className="text-sm">
              Link to a customer{' '}
              {preselectedLink ? null : (
                <span className="text-muted-foreground">(optional)</span>
              )}
            </Label>

            {preselectedLink ? (
              <div
                data-testid="preselected-link-chip"
                className="inline-flex items-center gap-2 rounded-full border bg-muted/60 px-3 py-1.5 text-sm"
              >
                <Icon
                  name={preselectedLink.type === 'lead' ? 'person_add' : 'list_alt'}
                  size="xs"
                />
                <span className="font-medium truncate max-w-[16rem]">
                  {preselectedLink.displayLabel}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {preselectedLink.type}
                </span>
              </div>
            ) : (
              <>
                <Input
                  id="add-task-link"
                  type="search"
                  placeholder="Search your assigned customers…"
                  value={linkSearch}
                  onChange={(e) => {
                    setLinkSearch(e.target.value);
                    setLinkRequestId(null);
                    setLinkLeadId(null);
                  }}
                  disabled={busy}
                  className="h-11"
                />
                {linkSearch.trim() !== '' && (
                  <ul
                    aria-label="Link suggestions"
                    className="rounded-md border bg-background"
                  >
                    {grouped.leads.length === 0 && grouped.requests.length === 0 ? (
                      <li className="px-3 py-2 text-xs text-muted-foreground">
                        No matches.
                      </li>
                    ) : (
                      <>
                        {grouped.leads.length > 0 && (
                          <li className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40">
                            Leads
                          </li>
                        )}
                        {grouped.leads.map((l) => (
                          <li
                            key={`lead-${l.id}`}
                            className="border-t first:border-t-0"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setLinkLeadId(l.id);
                                setLinkRequestId(null);
                                setLinkSearch(l.name);
                              }}
                              disabled={busy}
                              className={cn(
                                'w-full text-left px-3 py-2 hover:bg-muted text-sm flex items-center justify-between gap-2',
                                linkLeadId === l.id && 'bg-muted',
                              )}
                            >
                              <span className="truncate">{l.name}</span>
                              <span className="text-xs text-muted-foreground font-mono">
                                {l.phone}
                              </span>
                            </button>
                          </li>
                        ))}
                        {grouped.requests.length > 0 && (
                          <li className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40 border-t">
                            Requests
                          </li>
                        )}
                        {grouped.requests.map((r) => (
                          <li key={`req-${r.id}`} className="border-t">
                            <button
                              type="button"
                              onClick={() => {
                                setLinkRequestId(r.id);
                                setLinkLeadId(null);
                                setLinkSearch(r.customerName);
                              }}
                              disabled={busy}
                              className={cn(
                                'w-full text-left px-3 py-2 hover:bg-muted text-sm flex items-center justify-between gap-2',
                                linkRequestId === r.id && 'bg-muted',
                              )}
                            >
                              <span className="truncate">{r.customerName}</span>
                              <span className="text-xs text-muted-foreground font-mono">
                                {r.customerPhone}
                              </span>
                            </button>
                          </li>
                        ))}
                      </>
                    )}
                  </ul>
                )}
                {(linkRequestId || linkLeadId) && (
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="text-primary">Linked.</span>
                    <button
                      type="button"
                      className="underline text-muted-foreground"
                      onClick={clearLink}
                      disabled={busy}
                    >
                      Clear
                    </button>
                  </div>
                )}
              </>
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
            ) : editMode ? (
              'Save'
            ) : (
              'Add task'
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
