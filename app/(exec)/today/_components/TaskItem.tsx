'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import {
  CHIP_TASK_TYPES,
  FREE_TEXT_TASK_TYPES,
  resolveTaskDisplayMode,
} from '@/lib/today/task-rendering';

import {
  markTaskDoneAction,
  undoMarkDoneAction,
  undoPostponeAction,
} from '../actions';

import { EditTaskButton } from './EditTaskButton';
import { PostponeSheet } from './PostponeSheet';

// =============================================================================
// HVA-60 C/E: single task card with inline Mark-as-Done flow + Postpone trigger
// =============================================================================
//
// Render modes for Mark as Done:
//   - chip mode: task_type ∈ {Sales pitch, Customer home visit, Follow-up,
//                Installation & Activation}
//   - free-text mode: task_type ∈ {Outlet visit, Stall Activity, Other}
//   - defensive fallback: any unrecognised task_type defaults to
//                free-text mode AND console.warn. Covers schema drift if
//                a new task_type is added to the enum without a chip set
//                seeded in outcome_options.
//
// Undo (Bug 7 walk fix, was a 5-second sonner toast):
//   Persistent inline Undo button on every completed task card. The
//   toast was unreliable on mobile — easy to miss, position flips,
//   timer races. The button stays visible until the task gets another
//   mutation or the page reloads, so the exec can revert at their own
//   pace. setTimeout / refs are gone.
//
// All mutations are wrapped in useTransition (HVA-136) so the buttons
// stay disabled across the POST + refresh window.
// =============================================================================

export interface TaskItemProps {
  task: {
    id: string;
    taskType: string;
    description: string;
    estimatedTime: string;
    status: string;
    /** YYYY-MM-DD. HVA-159: needed to prefill the edit sheet's date picker. */
    taskDate: string;
    linkRequestId: string | null;
    linkLeadId: string | null;
    outcomeOptionId: string | null;
    outcomeOptionName: string | null;
    outcomeNotes: string | null;
    postponedToDate: string | null;
    customerInformed: boolean | null;
    createdAt: string;
  };
  outcomeOptionsForType: Array<{ id: string; code: string; name: string }>;
  postponeReasons: Array<{ id: string; code: string; name: string }>;
  readOnly: boolean;
  highlighted?: boolean;
  /** HVA-159: linkable pools threaded down so the row's edit button can
   *  open AddTaskSheet without redoing the fetch. Both default to []. */
  linkableRequests?: Array<{
    id: string;
    customerName: string;
    customerPhone: string;
  }>;
  linkableLeads?: Array<{ id: string; name: string; phone: string }>;
}

function resolveDisplayMode(taskType: string) {
  const mode = resolveTaskDisplayMode(taskType);
  // Defensive guard (Δ2 follow-on): unrecognised task_type → free-text
  // fallback AND console.warn so future enum drift surfaces in console.
  if (
    !(CHIP_TASK_TYPES as readonly string[]).includes(taskType) &&
    !(FREE_TEXT_TASK_TYPES as readonly string[]).includes(taskType) &&
    typeof console !== 'undefined'
  ) {
    console.warn(
      `[task-item] unrecognised task_type "${taskType}" — defaulting to free-text Mark Done mode`,
    );
  }
  return mode;
}

export function TaskItem({
  task,
  outcomeOptionsForType,
  postponeReasons,
  readOnly,
  highlighted = false,
  linkableRequests = [],
  linkableLeads = [],
}: TaskItemProps) {
  const router = useRouter();
  const displayMode = resolveDisplayMode(task.taskType);

  const [expanded, setExpanded] = useState(false);
  const [postponeOpen, setPostponeOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [showNotesInput, setShowNotesInput] = useState(false);
  const [freeText, setFreeText] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  async function performMarkDone(args: {
    outcomeOptionId: string | null;
    outcomeNotes: string | null;
  }) {
    if (busy) return;
    setSubmitting(true);
    try {
      const result = await markTaskDoneAction({
        taskId: task.id,
        outcomeOptionId: args.outcomeOptionId,
        outcomeNotes: args.outcomeNotes,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setExpanded(false);
      setShowNotesInput(false);
      setNotes('');
      setFreeText('');
      // Bug 7 fix: persistent inline Undo button replaces the 5s
      // sonner toast. The button lives on the completed task card
      // (rendered when status === 'completed'), so the exec can
      // revert at their own pace — no race against a timer.
      toast.success('Marked done');
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function performUndo(kind: 'done' | 'postpone') {
    if (busy) return;
    setSubmitting(true);
    try {
      const result =
        kind === 'done'
          ? await undoMarkDoneAction(task.id)
          : await undoPostponeAction(task.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      startTransition(() => {
        router.refresh();
      });
    } finally {
      setSubmitting(false);
    }
  }

  function onChipClick(outcomeOptionId: string) {
    void performMarkDone({
      outcomeOptionId,
      outcomeNotes: notes.trim() === '' ? null : notes.trim(),
    });
  }

  function onFreeTextConfirm() {
    const trimmed = freeText.trim();
    // Bug 2 fix: relaxed client gate from "5 chars" to "non-empty" so the
    // user-facing rule is just "type something". The server-side action
    // still validates 5–500 chars as belt-and-braces; if the server rejects,
    // the toast surfaces that error to the user. See the server action's
    // outcomeNotes branch for the authoritative gate.
    if (trimmed.length === 0) {
      toast.error('Type the outcome before confirming');
      return;
    }
    void performMarkDone({ outcomeOptionId: null, outcomeNotes: trimmed });
  }

  const isDone = task.status === 'completed';
  const isPostponed = task.status === 'postponed';
  const isPending_ = task.status === 'pending';

  const statusIndicator = isDone ? (
    <Badge className="bg-green-600 text-white">Done</Badge>
  ) : isPostponed ? (
    <Badge className="bg-orange-500 text-white">Postponed</Badge>
  ) : (
    <Badge variant="secondary">Pending</Badge>
  );

  return (
    <div
      className={cn(
        'rounded-2xl border bg-card p-4 shadow-sm space-y-3',
        highlighted && 'ring-2 ring-primary/40 border-primary/30',
      )}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-[10px]">
            {task.taskType}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            {task.estimatedTime}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {/* HVA-159: edit pencil for pending/postponed tasks. Completed
              and cancelled tasks are immutable per canExecEditTask. */}
          {!readOnly && (isPending_ || isPostponed) && (
            <EditTaskButton
              task={{
                id: task.id,
                taskType: task.taskType,
                description: task.description,
                estimatedTime: task.estimatedTime,
                taskDate: task.taskDate,
                linkRequestId: task.linkRequestId,
                linkLeadId: task.linkLeadId,
              }}
              linkableRequests={linkableRequests}
              linkableLeads={linkableLeads}
            />
          )}
          {statusIndicator}
        </div>
      </div>

      <p className="text-sm leading-relaxed">{task.description}</p>

      {task.linkRequestId && (
        <a
          href={`/requests/${task.linkRequestId}`}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <Icon name="link" size="xs" />
          View linked request
        </a>
      )}

      {task.linkLeadId && !task.linkRequestId && (
        <a
          href={`/leads/${task.linkLeadId}`}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <Icon name="link" size="xs" />
          View linked lead
        </a>
      )}

      {/* Change B + C (HVA-60 design polish): icon-only Undo button on
          BOTH completed and postponed tasks. 36dp square (h-9 w-9 ≈ 44dp
          tap target via padding), ghost variant, focus-visible ring for
          keyboard nav. aria-label differentiates "Undo mark as done"
          vs "Undo postpone" so screen readers get the right phrasing
          for each case. */}
      {isDone && (
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs text-muted-foreground space-y-0.5 flex-1">
            {task.outcomeOptionName && (
              <p>
                <span className="font-medium text-foreground/80">Outcome:</span>{' '}
                {task.outcomeOptionName}
              </p>
            )}
            {task.outcomeNotes && (
              <p className="whitespace-pre-line">
                <span className="font-medium text-foreground/80">Notes:</span>{' '}
                {task.outcomeNotes}
              </p>
            )}
          </div>
          {!readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                void performUndo('done');
              }}
              disabled={busy}
              aria-label="Undo mark as done"
              title="Undo"
              className="h-9 w-9 shrink-0 rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon name="undo" size="sm" />
            </Button>
          )}
        </div>
      )}

      {isPostponed && (
        <div className="flex items-start justify-between gap-2">
          <div className="text-xs text-muted-foreground space-y-0.5 flex-1">
            {task.postponedToDate && (
              <p>
                <span className="font-medium text-foreground/80">Postponed to:</span>{' '}
                {task.postponedToDate}
              </p>
            )}
            {task.customerInformed !== null && (
              <p>
                <span className="font-medium text-foreground/80">Customer informed:</span>{' '}
                {task.customerInformed ? 'Yes' : 'No'}
              </p>
            )}
          </div>
          {!readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => {
                void performUndo('postpone');
              }}
              disabled={busy}
              aria-label="Undo postpone"
              title="Undo"
              className="h-9 w-9 shrink-0 rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon name="undo" size="sm" />
            </Button>
          )}
        </div>
      )}

      {!readOnly && isPending_ && !expanded && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            onClick={() => setExpanded(true)}
            disabled={busy}
          >
            <Icon name="check" size="xs" />
            Mark as Done
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setPostponeOpen(true)}
            disabled={busy}
          >
            <Icon name="schedule" size="xs" />
            Postpone
          </Button>
        </div>
      )}

      {!readOnly && isPending_ && expanded && displayMode === 'chips' && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap gap-2">
            {outcomeOptionsForType.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No outcome chips configured for {task.taskType}. Add them under
                Admin → Outcome options.
              </p>
            ) : (
              outcomeOptionsForType.map((opt) => (
                <Button
                  key={opt.id}
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="rounded-full"
                  onClick={() => onChipClick(opt.id)}
                  disabled={busy}
                >
                  {opt.name}
                </Button>
              ))
            )}
          </div>
          {!showNotesInput ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowNotesInput(true)}
                disabled={busy}
              >
                <Icon name="add" size="xs" />
                Add notes
              </Button>
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setExpanded(false);
                    setShowNotesInput(false);
                    setNotes('');
                  }}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            // Bug 8 walk fix: chip mode's "Add notes" expander had only
            // an outer Cancel that exited the entire Mark Done flow.
            // The expander itself needs its own Cancel + Save pair —
            // Save commits the typed value to the `notes` state (which
            // the next chip click reads + sends to outcomeNotes on the
            // action), Cancel discards. Matches the visual treatment of
            // the free-text mode buttons below for consistency.
            <div className="space-y-2">
              <Textarea
                placeholder="Notes (optional)…"
                value={notes}
                onChange={(e) => setNotes(e.target.value.slice(0, 500))}
                rows={2}
                maxLength={500}
                aria-label="Outcome notes"
              />
              <p className="text-xs text-muted-foreground">
                Notes attach to whichever outcome you tap below.
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowNotesInput(false);
                    setNotes('');
                  }}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    // Save = collapse the textarea, keep the typed
                    // value in `notes` state so the next chip click
                    // sends it. Server-side validation lives in
                    // markTaskDoneAction (1–500 chars when notes is
                    // present).
                    setShowNotesInput(false);
                  }}
                  disabled={busy || notes.trim().length === 0}
                >
                  Save note
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {!readOnly && isPending_ && expanded && displayMode === 'free_text' && (
        <div className="space-y-2 pt-1">
          <Textarea
            placeholder="What was the outcome?"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value.slice(0, 500))}
            rows={3}
            maxLength={500}
            aria-label="Outcome description"
          />
          {/* Bug 2 fix: hint text under the textarea so the exec knows
              the Confirm button is just waiting on some input. The
              hint stays on-screen at all times — disabled-button greyness
              previously left it unclear whether anything was actionable. */}
          <p className="text-xs text-muted-foreground">
            Enter the outcome details
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setExpanded(false);
                setFreeText('');
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={onFreeTextConfirm}
              // Bug 2 fix: enabled as soon as the textarea has ANY
              // non-whitespace content. Server-side still validates
              // (5–500 chars) and surfaces a toast on rejection — the
              // client-side rule used to be 5 chars too, which made the
              // button look broken when the exec was mid-typing.
              disabled={busy || freeText.trim().length === 0}
            >
              {busy ? (
                <>
                  <Icon name="progress_activity" size="xs" className="animate-spin" />
                  Saving…
                </>
              ) : (
                'Confirm'
              )}
            </Button>
          </div>
        </div>
      )}

      {postponeOpen && (
        <PostponeSheet
          taskId={task.id}
          reasons={postponeReasons}
          onClose={() => setPostponeOpen(false)}
        />
      )}
    </div>
  );
}
