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
import { Textarea } from "@/components/ui/textarea";

// =============================================================================
// HVA-137: shared "Approve & complete order" modal
// =============================================================================
//
// Captain (or super_admin) confirms approval at PENDING_CAPTAIN_APPROVAL.
// Optional note (≤ 500 chars). On confirm posts to
// /api/requests/[id]/approve and refreshes — HVA-136 useTransition
// pattern holds the buttons disabled across both the POST and the RSC
// reconciliation. Used from both /requests/[id] and /captain/approvals.
// =============================================================================

const NOTE_MAX = 500;

export interface ApproveRequestModalProps {
  requestId: string;
  customerName: string;
  open: boolean;
  onClose: () => void;
}

export function ApproveRequestModal({
  requestId,
  customerName,
  open,
  onClose,
}: ApproveRequestModalProps) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  async function onConfirm() {
    if (busy) return;
    setSubmitting(true);
    setGeneralError(null);
    try {
      const trimmed = note.trim();
      const res = await fetch(`/api/requests/${requestId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trimmed === "" ? {} : { note: trimmed }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || !j.ok) {
        setGeneralError(
          j.message ?? j.error ?? `Approval failed (${res.status}).`,
        );
        toast.error(j.message ?? j.error ?? "Could not approve.");
        return;
      }
      toast.success(`Approved ${customerName}'s order.`);
      setNote("");
      onClose();
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setGeneralError(
        err instanceof Error ? `Network error: ${err.message}` : "Network error",
      );
    } finally {
      setSubmitting(false);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !busy) {
      setNote("");
      setGeneralError(null);
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Approve {customerName}&apos;s order?</DialogTitle>
          <DialogDescription>
            Marks the request as completed and notifies the assigned exec.
            This is the final stage.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor={`approve-note-${requestId}`}>
            Note <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id={`approve-note-${requestId}`}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
            placeholder="e.g. Great work, customer is happy."
            disabled={busy}
            maxLength={NOTE_MAX}
            rows={3}
            className="resize-none"
          />
          <div className="flex justify-end text-xs text-muted-foreground">
            <span aria-live="polite">
              {note.length}/{NOTE_MAX}
            </span>
          </div>
          {generalError && (
            <div
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive border border-destructive/30"
            >
              {generalError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? (
              <>
                <Icon
                  name="progress_activity"
                  size="sm"
                  className="animate-spin"
                />
                <span>Approving…</span>
              </>
            ) : (
              "Approve & complete order"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
