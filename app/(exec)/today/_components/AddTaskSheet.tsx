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
 * HVA-170 D5 / HVA-170-FIX1 D14: when supplied (and `taskToEdit` is absent),
 * AddTaskSheet renders in clone mode — pre-filled from the source task
 * (type / description / estimatedTime) and submits a NEW row via
 * addTaskAction. taskDate defaults to today (D7).
 *
 * HVA-170-FIX1: linkRequestId / linkLeadId are NO LONGER copied from the
 * source. The original "Request not assigned to you" toast happened when
 * a stale link reference was submitted with a task created by an exec who
 * is no longer the assignee. The exec re-links manually in the sheet.
 */
export interface CloneFromTask {
  taskType: string;
  description: string;
  estimatedTime: string;
}

interface Props {
  trigger?: React.ReactNode;
  linkableRequests: LinkableRequest[];
  linkableLeads?: LinkableLead[];
  /** When true, FAB renders disabled (read-only state — day closed). */
  disabled?: boolean;
  /** HVA-150: opt-in optimistic UI hooks passed through to AddTaskSheet.
   *  When provided + add mode, sheet inserts a pending row in the parent
   *  list immediately on submit, closes, then reconciles or rolls back
   *  based on the server action's result. */
  onOptimisticAdd?: AddTaskOptimisticHandlers['onAdd'];
  onOptimisticReconcile?: AddTaskOptimisticHandlers['onReconcile'];
  onOptimisticRemove?: AddTaskOptimisticHandlers['onRemove'];
}

/** HVA-150 opt-in optimistic Add Task contract. Add mode only — edit /
 *  clone always go through the existing useTransition path. */
export interface AddTaskOptimisticHandlers {
  /** Insert a pending row in the parent list. Parent owns the id. */
  onAdd: (insert: {
    id: string;
    taskType: string;
    description: string;
    estimatedTime: string;
    taskDate: string;
    linkRequestId: string | null;
    linkLeadId: string | null;
  }) => void;
  /** Server returned success — swap temp id for real id. */
  onReconcile: (tempId: string, serverTaskId: string) => void;
  /** Server returned failure — drop the pending row. */
  onRemove: (tempId: string) => void;
}

// HVA-60 design polish (Change A): AddTaskFab no longer owns its own
// positioning. The parent <BottomActions> wrapper in PostSubmissionView
// renders this FAB alongside the optional Close-the-Day button in the
// bottom-right corner.
export function AddTaskFab({
  linkableRequests,
  linkableLeads = [],
  disabled = false,
  onOptimisticAdd,
  onOptimisticReconcile,
  onOptimisticRemove,
}: Props) {
  const [open, setOpen] = useState(false);
  const optimistic =
    onOptimisticAdd && onOptimisticReconcile && onOptimisticRemove
      ? {
          onAdd: onOptimisticAdd,
          onReconcile: onOptimisticReconcile,
          onRemove: onOptimisticRemove,
        }
      : undefined;
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
          optimistic={optimistic}
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
  initialTaskDate,
  onClose,
  optimistic,
}: {
  linkableRequests: LinkableRequest[];
  linkableLeads?: LinkableLead[];
  preselectedLink?: PreselectedLink;
  /** HVA-159: when present, renders in edit mode and calls editTaskAction. */
  taskToEdit?: TaskToEdit;
  /** HVA-170 D5: when present (and taskToEdit absent), renders in clone
   *  mode — prefills from source but submits a NEW row via addTaskAction. */
  cloneFromTask?: CloneFromTask;
  /** F3 2026-05-26: when the sheet is opened from /calendar, prefill the
   *  task_date with the day the captain was viewing. The picker is still
   *  editable; this just saves a tap. */
  initialTaskDate?: string;
  onClose: () => void;
  /** HVA-150 opt-in: when provided and in add mode (not edit, not clone),
   *  the sheet inserts a pending row in the parent list, closes, and
   *  reconciles or rolls back based on the server action's result. */
  optimistic?: AddTaskOptimisticHandlers;
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
    taskToEdit?.taskDate ?? initialTaskDate ?? todayLocalIso(),
  );
  const [description, setDescription] = useState(
    taskToEdit?.description ?? cloneFromTask?.description ?? '',
  );
  const [estimatedTime, setEstimatedTime] = useState<string>(
    taskToEdit?.estimatedTime ?? cloneFromTask?.estimatedTime ?? '30min',
  );
  // HVA-170-FIX1 D14: clone mode does NOT inherit the source's link.
  // The exec re-links manually in the sheet (the original assignment
  // may have moved on). Only edit mode inherits the existing link.
  const [linkRequestId, setLinkRequestId] = useState<string | null>(
    taskToEdit?.linkRequestId ?? null,
  );
  const [linkLeadId, setLinkLeadId] = useState<string | null>(
    taskToEdit?.linkLeadId ?? null,
  );
  // HVA-170-FIX2: seed linkSearch with the linked customer's name when
  // opening in edit mode. Pre-fix, the search input rendered empty even
  // when linkRequestId/linkLeadId were hydrated — only a tiny "Linked."
  // indicator surfaced the link state, so the customer field looked
  // empty (Sandeep's walk repro). The lookup uses the pools the page
  // already loaded; if the linked entity has fallen out of the current
  // pool (e.g., request reassigned away), `linkedFallbackLabel` below
  // surfaces a "Linked customer (not in your current list)" pill so the
  // exec still sees that the link exists.
  const [linkSearch, setLinkSearch] = useState<string>(() => {
    if (taskToEdit?.linkRequestId) {
      const r = linkableRequests.find(
        (x) => x.id === taskToEdit.linkRequestId,
      );
      return r?.customerName ?? '';
    }
    if (taskToEdit?.linkLeadId) {
      const l = linkableLeads.find((x) => x.id === taskToEdit.linkLeadId);
      return l?.name ?? '';
    }
    return '';
  });
  // True when the task has a link that ISN'T in the current linkable
  // pool — surfaces a defensive pill so the exec doesn't think the
  // link is broken.
  const linkedFallbackLabel = (() => {
    if (linkSearch !== '') return null;
    if (taskToEdit?.linkRequestId) {
      const inPool = linkableRequests.some(
        (x) => x.id === taskToEdit.linkRequestId,
      );
      return inPool ? null : 'Linked customer (not in your current list)';
    }
    if (taskToEdit?.linkLeadId) {
      const inPool = linkableLeads.some(
        (x) => x.id === taskToEdit.linkLeadId,
      );
      return inPool ? null : 'Linked contact (not in your current list)';
    }
    return null;
  })();

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
  // eslint-disable-next-line no-restricted-syntax -- HVA-149: predates useServerMutation; HVA-149-cleanup TODO
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
    // HVA-150 opt-in: add mode + optimistic handlers → close immediately,
    // surface a pending row in the parent list, then reconcile on result.
    // Edit + clone modes always use the legacy path (no double-submit
    // risk + the form's own busy state already covers the perception gap).
    const isAddMode = !editMode && !cloneMode;
    if (isAddMode && optimistic) {
      const tempId = `task-temp-${
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2)
      }`;
      optimistic.onAdd({
        id: tempId,
        taskType,
        description: description.trim(),
        estimatedTime,
        taskDate,
        linkRequestId: linkRequestId ?? null,
        linkLeadId: linkLeadId ?? null,
      });
      onClose();
      try {
        const result = await addTaskAction({
          taskType,
          description: description.trim(),
          estimatedTime,
          taskDate,
          linkRequestId: linkRequestId ?? null,
          linkLeadId: linkLeadId ?? null,
        });
        if (!result.ok) {
          optimistic.onRemove(tempId);
          toast.error(result.error);
          return;
        }
        if (result.data) {
          optimistic.onReconcile(tempId, result.data.taskId);
        } else {
          // Defensive fallback — server returned ok but no data. Drop the
          // optimistic row so router.refresh seeds it from the canonical
          // server list instead.
          optimistic.onRemove(tempId);
        }
        toast.success('Task added');
        startTransition(() => {
          router.refresh();
        });
      } catch (err) {
        optimistic.onRemove(tempId);
        toast.error(err instanceof Error ? err.message : 'Network error');
      }
      return;
    }

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
            <Label className="text-sm">Task type</Label>
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
              Task date
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
              Description
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
              Estimated time
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

          {/* Link to request OR lead. HVA-170-FIX3: when a link is set
              (either inherited from taskToEdit or just picked from the
              suggestion list), render a chip card with the customer's
              name + phone + "Change" button instead of leaving the
              customer name living as plain text inside the search
              input. Clicking Change clears the link and brings the
              search input back. Out-of-pool links surface a defensive
              "not in your current list" sub-label. */}
          <div className="space-y-2">
            <Label htmlFor="add-task-link" className="text-sm">
              Link to a customer{' '}
              {preselectedLink || linkRequestId || linkLeadId ? null : (
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
            ) : (linkRequestId || linkLeadId) ? (
              <LinkedCustomerChip
                isLead={Boolean(linkLeadId)}
                name={linkSearch}
                phone={
                  linkRequestId
                    ? linkableRequests.find((r) => r.id === linkRequestId)
                        ?.customerPhone ?? null
                    : linkableLeads.find((l) => l.id === linkLeadId)?.phone ??
                      null
                }
                fallbackLabel={linkedFallbackLabel}
                disabled={busy}
                onChange={clearLink}
              />
            ) : (
              <>
                <Input
                  id="add-task-link"
                  type="search"
                  placeholder="Search your assigned customers…"
                  value={linkSearch}
                  onChange={(e) => setLinkSearch(e.target.value)}
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

// =============================================================================
// HVA-170-FIX3: linked-customer chip
// =============================================================================
//
// Rendered in the AddTaskSheet's link slot when a link is set. Surfaces
// the customer name + phone + type pill prominently — not as plain text
// inside a search input. "Change" clears the link and brings the search
// input back; the user can then re-link or leave the task unlinked.
//
// `fallbackLabel` covers the defensive case where the link points at a
// request/lead that's no longer in the exec's current pool (e.g.,
// request reassigned away after the task was created). Name + phone
// can't be resolved, but the chip still signals "this task is linked"
// so the exec understands the state.
// =============================================================================

function LinkedCustomerChip({
  isLead,
  name,
  phone,
  fallbackLabel,
  disabled,
  onChange,
}: {
  isLead: boolean;
  name: string;
  phone: string | null;
  fallbackLabel: string | null;
  disabled: boolean;
  onChange: () => void;
}) {
  const resolvedName = name.trim() !== '' ? name : fallbackLabel;
  return (
    <div className="rounded-xl border bg-card p-3 flex items-start gap-3 shadow-sm">
      <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <Icon name={isLead ? 'person_add' : 'person'} size="sm" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">
          {resolvedName ?? 'Linked customer'}
        </p>
        {phone && (
          <p className="text-xs text-muted-foreground font-mono">{phone}</p>
        )}
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">
          {isLead ? 'Lead' : 'Customer'}
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onChange}
        disabled={disabled}
        className="shrink-0"
      >
        Change
      </Button>
    </div>
  );
}
