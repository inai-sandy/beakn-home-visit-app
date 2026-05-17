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
// HVA-70: Void a payment row — captain-of-city / super_admin only
// =============================================================================
//
// Voiding is a fat-finger correction. The row stays in the DB (audit
// trail) but is excluded from totals. Reason ≥ 10 chars required by the
// server validator.
// =============================================================================

const REASON_MIN = 10;
const REASON_MAX = 1000;

export function PaymentVoidButton({
  requestId,
  paymentId,
}: {
  requestId: string;
  paymentId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-8 text-xs text-destructive hover:bg-destructive/10"
      >
        <Icon name="cancel" size="xs" />
        <span>Void</span>
      </Button>
      {open && (
        <VoidDialog
          requestId={requestId}
          paymentId={paymentId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function VoidDialog({
  requestId,
  paymentId,
  onClose,
}: {
  requestId: string;
  paymentId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  // HVA-136: pending-refresh signal — see other mutation buttons in
  // this directory for full rationale.
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  const trimmed = reason.trim();
  const canSubmit = !busy && trimmed.length >= REASON_MIN;

  async function onConfirm() {
    if (!canSubmit) return;
    setSubmitting(true);
    setGeneralError(null);
    try {
      const res = await fetch(
        `/api/requests/${requestId}/payments/${paymentId}/void`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: trimmed }),
        },
      );
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !j.ok) {
        setGeneralError(j.error ?? `Request failed (${res.status})`);
        toast.error(j.error ?? "Could not void payment.");
        return;
      }
      toast.success("Payment voided.");
      startTransition(() => {
        router.refresh();
      });
      onClose();
    } catch (err) {
      setGeneralError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Void this payment?</DialogTitle>
          <DialogDescription>
            The row stays in history but is excluded from totals. Give a
            specific reason — this is audited.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label htmlFor="void-reason" className="text-sm">
            Reason <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="void-reason"
            placeholder="Wrong amount entered, duplicate, customer reversed UPI…"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
            disabled={busy}
            maxLength={REASON_MAX}
            rows={3}
            className="resize-none"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {trimmed.length < REASON_MIN && trimmed.length > 0 && (
                <span className="text-destructive">
                  Min {REASON_MIN} characters.
                </span>
              )}
            </span>
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
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={!canSubmit}
          >
            {busy ? (
              <>
                <Icon
                  name="progress_activity"
                  size="sm"
                  className="animate-spin"
                />
                <span>Voiding…</span>
              </>
            ) : (
              "Void payment"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
