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
import { cn } from "@/lib/utils";

// =============================================================================
// HVA-137: shared "Request changes (Reject)" modal
// =============================================================================
//
// Captain (or super_admin) sends the request back from
// PENDING_CAPTAIN_APPROVAL to INSTALLATION_SCHEDULED. Reason is
// MANDATORY (50–500 chars).
//
// 2026-05-26: migrated from hand-rolled useTransition to useServerMutation
// via the new createFetchAction wrapper. Same /reject API route, same
// behaviour — the refresh-required pattern now lives in one place.
// =============================================================================

const REASON_MIN = 50;
const REASON_MAX = 500;

const rejectRequestAction = createFetchAction<{
  requestId: string;
  reason: string;
}>({
  urlFor: (input) => `/api/requests/${input.requestId}/reject`,
  bodyFor: (input) => JSON.stringify({ reason: input.reason }),
});

export interface RejectRequestModalProps {
  requestId: string;
  customerName: string;
  open: boolean;
  onClose: () => void;
}

export function RejectRequestModal({
  requestId,
  customerName,
  open,
  onClose,
}: RejectRequestModalProps) {
  const [reason, setReason] = useState("");
  const [generalError, setGeneralError] = useState<string | null>(null);

  const { mutate, isPending: busy } = useServerMutation(rejectRequestAction, {
    onSuccess: () => {
      toast.success(
        `Sent ${customerName}'s order back to Installation Scheduled.`,
      );
      setReason("");
      onClose();
    },
    onError: (err) => setGeneralError(err),
    suppressErrorToast: false,
  });

  const trimmed = reason.trim();
  const reasonValid =
    trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX;
  const canSubmit = !busy && reasonValid;

  function onConfirm() {
    if (!canSubmit) return;
    setGeneralError(null);
    void mutate({ requestId, reason: trimmed });
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !busy) {
      setReason("");
      setGeneralError(null);
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>
            Request changes on {customerName}&apos;s order?
          </DialogTitle>
          <DialogDescription>
            Sends the request back to Installation Scheduled. The assigned
            exec will see your reason and can resume from there.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor={`reject-reason-${requestId}`}>
            Reason <span className="text-destructive">*</span>
            <span className="text-muted-foreground ml-1">
              ({REASON_MIN}–{REASON_MAX} chars)
            </span>
          </Label>
          <Textarea
            id={`reject-reason-${requestId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
            placeholder="e.g. The mounting bracket placement near the puja shelf needs adjustment. Please revisit with the customer before completing."
            disabled={busy}
            maxLength={REASON_MAX}
            rows={4}
            className="resize-none"
          />
          <div className="flex justify-end text-xs">
            <span
              className={cn(
                trimmed.length === 0 || reasonValid
                  ? "text-muted-foreground"
                  : "text-destructive",
              )}
              aria-live="polite"
            >
              {trimmed.length}/{REASON_MAX}
              {trimmed.length > 0 && trimmed.length < REASON_MIN && (
                <span> · need at least {REASON_MIN}</span>
              )}
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
          <Button
            variant="outline"
            onClick={onConfirm}
            disabled={!canSubmit}
            className="border-destructive/60 text-destructive hover:bg-destructive/10"
          >
            {busy ? (
              <>
                <Icon
                  name="progress_activity"
                  size="sm"
                  className="animate-spin"
                />
                <span>Sending back…</span>
              </>
            ) : (
              "Request changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
