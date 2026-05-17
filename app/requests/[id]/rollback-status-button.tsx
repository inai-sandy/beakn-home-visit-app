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
// HVA-141: Roll back one stage — visible to assigned exec, captain-of-city,
// super_admin at any non-SUBMITTED, non-PENDING_CAPTAIN_APPROVAL, non-terminal,
// non-cancelled stage.
//
// Click opens a confirmation modal:
//   - Title:    "Move {customerName} back to {previousStageName}?"
//   - Body:     optional Reason textarea, ≤ 500 chars
//   - Buttons:  Cancel + Move back
//
// On Confirm: POST /api/requests/[id]/rollback with { reason? } → toast +
// modal close + router.refresh (wrapped in startTransition per HVA-136 so
// the button stays disabled until the new RSC payload lands).
// =============================================================================

const REASON_MAX = 500;

interface RollbackStatusButtonProps {
  requestId: string;
  customerName: string;
  previousStage: { id: string; name: string };
}

export function RollbackStatusButton({
  requestId,
  customerName,
  previousStage,
}: RollbackStatusButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="w-full sm:w-auto h-11 px-4 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <Icon name="undo" size="sm" />
        <span>Go back to {previousStage.name}</span>
      </Button>
      {open && (
        <RollbackDialog
          requestId={requestId}
          customerName={customerName}
          previousStage={previousStage}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function RollbackDialog({
  requestId,
  customerName,
  previousStage,
  onClose,
}: {
  requestId: string;
  customerName: string;
  previousStage: { id: string; name: string };
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  async function onConfirm() {
    if (busy) return;
    setSubmitting(true);
    setGeneralError(null);
    try {
      const trimmed = reason.trim();
      const res = await fetch(`/api/requests/${requestId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trimmed === "" ? {} : { reason: trimmed }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || !j.ok) {
        setGeneralError(
          j.message ?? j.error ?? `Rollback failed (${res.status}).`,
        );
        toast.error(j.message ?? j.error ?? "Could not roll back.");
        return;
      }
      toast.success(`Moved back to ${previousStage.name}.`);
      startTransition(() => {
        router.refresh();
      });
      onClose();
    } catch (err) {
      setGeneralError(
        err instanceof Error ? `Network error: ${err.message}` : "Network error",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>
            Move {customerName} back to {previousStage.name}?
          </DialogTitle>
          <DialogDescription>
            The customer will see this on their tracking page; the city
            captain will get an in-app notification.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="rollback-reason" className="text-sm">
            Reason <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="rollback-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
            placeholder="e.g. Customer wasn't home, retrying tomorrow"
            disabled={busy}
            maxLength={REASON_MAX}
            rows={3}
            className="resize-none"
          />
          <div className="flex justify-end text-xs text-muted-foreground">
            <span aria-live="polite">
              {reason.length}/{REASON_MAX}
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
                <span>Moving back…</span>
              </>
            ) : (
              "Move back"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
