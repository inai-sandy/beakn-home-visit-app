"use client";

import { useState } from "react";
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
import { createFetchAction } from "@/lib/api/fetch-action";
import { useServerMutation } from "@/lib/hooks/use-server-mutation";

// =============================================================================
// HVA-137: shared "Approve & complete order" modal
// =============================================================================
//
// 2026-05-26: migrated to useServerMutation via createFetchAction.
// Same /approve API route + behaviour as before.
// =============================================================================

const NOTE_MAX = 500;

const approveRequestAction = createFetchAction<{
  requestId: string;
  note?: string;
}>({
  urlFor: (input) => `/api/requests/${input.requestId}/approve`,
  bodyFor: (input) =>
    JSON.stringify(input.note ? { note: input.note } : {}),
});

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
  const [note, setNote] = useState("");
  const [generalError, setGeneralError] = useState<string | null>(null);

  const { mutate, isPending: busy } = useServerMutation(approveRequestAction, {
    onSuccess: () => {
      toast.success(`Approved ${customerName}'s order.`);
      setNote("");
      onClose();
    },
    onError: (err) => setGeneralError(err),
  });

  function onConfirm() {
    if (busy) return;
    setGeneralError(null);
    const trimmed = note.trim();
    void mutate({ requestId, note: trimmed === "" ? undefined : trimmed });
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
