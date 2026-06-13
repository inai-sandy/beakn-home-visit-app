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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rupeesStringToPaise } from "@/lib/money";

// =============================================================================
// HVA-281: Target editor — the exec's GOAL value for this request
// =============================================================================
//
// Replaces the old manual quotation entry. The real quotation now comes
// from CartPlus (read-only in Beakn). The target is a number the exec
// aims for; it never enters finance math.
// =============================================================================

export function TargetEditButton({
  requestId,
  existingPaise,
}: {
  requestId: string;
  existingPaise: number | null;
}) {
  const [open, setOpen] = useState(false);
  const hasTarget = existingPaise !== null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-9"
      >
        <Icon name={hasTarget ? "edit" : "add"} size="xs" />
        <span>{hasTarget ? "Edit target" : "Set target"}</span>
      </Button>
      {open && (
        <TargetDialog
          requestId={requestId}
          existingPaise={existingPaise}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function paiseToRupeesString(paise: number): string {
  return (paise / 100).toFixed(2).replace(/\.00$/, "");
}

function TargetDialog({
  requestId,
  existingPaise,
  onClose,
}: {
  requestId: string;
  existingPaise: number | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(
    existingPaise !== null ? paiseToRupeesString(existingPaise) : "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  const paise = rupeesStringToPaise(amount);
  const amountValid = paise !== null;
  const canSubmit = !busy && amountValid;

  async function onSubmit() {
    if (!canSubmit || paise === null) return;
    setSubmitting(true);
    setGeneralError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/target`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetValuePaise: paise }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !j.ok) {
        setGeneralError(j.error ?? `Request failed (${res.status})`);
        toast.error(j.error ?? "Could not save target.");
        return;
      }
      toast.success("Target saved.");
      startTransition(() => router.refresh());
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
          <DialogTitle>{existingPaise !== null ? "Edit target" : "Set target"}</DialogTitle>
          <DialogDescription>
            The value you&apos;re aiming for on this request. The actual
            quotation comes from CartPlus.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="target-amount" className="text-sm">
            Target value (₹) <span className="text-destructive">*</span>
          </Label>
          <Input
            id="target-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="e.g. 125000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy}
            className="h-12 font-mono"
          />
          {!amountValid && amount.trim() !== "" && (
            <p className="text-xs text-destructive">
              Enter a positive number with at most 2 decimals.
            </p>
          )}
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
          <Button onClick={onSubmit} disabled={!canSubmit}>
            {busy ? (
              <>
                <Icon name="progress_activity" size="sm" className="animate-spin" />
                <span>Saving…</span>
              </>
            ) : (
              "Save target"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
