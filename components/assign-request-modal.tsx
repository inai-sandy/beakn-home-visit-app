"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// =============================================================================
// HVA-139: shared "Assign Sales Executive" modal
// =============================================================================
//
// Single source of truth for the assignment UX, used by three entry
// points:
//   - /captain/requests/unassigned         (HVA-81 row trigger)
//   - /requests/[id]                       (HVA-139 detail-page button)
//   - /captain/requests                    (HVA-139 inline row button)
//
// Posts to /api/requests/[id]/assign with { execUserId, note? }. The
// route atomically sets assigned_exec_user_id + assigned_captain_user_id
// + assigned_at AND transitions Submitted→Assigned inside one tx.
//
// Pattern is controlled: caller owns the open/closed state and supplies
// the request id + the captain's exec list. The modal handles submit,
// toast, router.refresh, and close (via the supplied onClose). HVA-136's
// useTransition pattern keeps the buttons disabled across both the
// in-flight POST and the subsequent RSC reconciliation.
// =============================================================================

export interface AssignRequestModalProps {
  requestId: string;
  execs: Array<{ id: string; fullName: string }>;
  open: boolean;
  onClose: () => void;
}

export function AssignRequestModal({
  requestId,
  execs,
  open,
  onClose,
}: AssignRequestModalProps) {
  const router = useRouter();
  const [execId, setExecId] = useState<string>("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  async function onConfirm() {
    if (!execId || busy) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/requests/${requestId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ execUserId: execId, note: note || undefined }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        assignedExec?: { fullName: string };
      };
      if (!res.ok || !j.ok) {
        toast.error(j.error ?? `Assignment failed (${res.status}).`);
        return;
      }
      toast.success(`Assigned to ${j.assignedExec?.fullName ?? "exec"}`);
      // Reset local state before close so re-opening the modal in the
      // same session starts clean.
      setExecId("");
      setNote("");
      onClose();
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `Network error: ${err.message}`
          : "Network error",
      );
    } finally {
      setSubmitting(false);
    }
  }

  // Closing via Cancel / Escape / scrim-click also needs to reset the
  // form so the next open() doesn't carry a half-filled state from a
  // dismissed previous attempt.
  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !busy) {
      setExecId("");
      setNote("");
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Assign sales executive</DialogTitle>
          <DialogDescription>
            Pick an exec on your team. They&apos;ll be notified
            automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`assign-exec-${requestId}`}>
              Sales executive
            </Label>
            <Select
              value={execId || undefined}
              onValueChange={setExecId}
              disabled={busy || execs.length === 0}
            >
              <SelectTrigger
                id={`assign-exec-${requestId}`}
                className="h-12 w-full rounded-input"
              >
                <SelectValue
                  placeholder={
                    execs.length === 0
                      ? "No execs available"
                      : "Select an exec"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {execs.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`assign-note-${requestId}`}>Note (optional)</Label>
            <Textarea
              id={`assign-note-${requestId}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Anything the exec should know — recent contact, urgency, etc."
              disabled={busy}
              className="rounded-input"
            />
          </div>
        </div>

        <DialogFooter>
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
            onClick={onConfirm}
            disabled={busy || !execId}
          >
            {busy ? (
              <>
                <Icon
                  name="progress_activity"
                  size="sm"
                  className="animate-spin"
                />
                <span>Assigning…</span>
              </>
            ) : (
              "Confirm Assign"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
