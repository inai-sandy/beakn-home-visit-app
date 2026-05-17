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
import { Textarea } from "@/components/ui/textarea";
import { rupeesStringToPaise } from "@/lib/money";

// =============================================================================
// HVA-70: Quotation editor — create or revise the headline order total
// =============================================================================
//
// Per HVA-70 design deviations, quotations are intentionally mutable —
// every revision is audited server-side via quotation_updated. UI shows
// the existing values pre-filled so the user can edit in place.
// =============================================================================

const NOTES_MAX = 2000;
const NUMBER_MAX = 100;

interface ExistingQuotation {
  totalOrderValuePaise: number;
  quotationNumber: string | null;
  notes: string | null;
}

export function QuotationEditButton({
  requestId,
  existing,
}: {
  requestId: string;
  existing: ExistingQuotation | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant={existing ? "outline" : "default"}
        size="sm"
        onClick={() => setOpen(true)}
        className="h-9"
      >
        <Icon name={existing ? "edit" : "add"} size="xs" />
        <span>{existing ? "Edit quotation" : "Add quotation"}</span>
      </Button>
      {open && (
        <QuotationDialog
          requestId={requestId}
          existing={existing}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function paiseToRupeesString(paise: number): string {
  // Two-decimal string for display in the rupee input. We never grouping
  // here — Indian commas in an <input> trip up custom typing.
  return (paise / 100).toFixed(2).replace(/\.00$/, "");
}

function QuotationDialog({
  requestId,
  existing,
  onClose,
}: {
  requestId: string;
  existing: ExistingQuotation | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(
    existing ? paiseToRupeesString(existing.totalOrderValuePaise) : "",
  );
  const [number, setNumber] = useState(existing?.quotationNumber ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  // HVA-136: pending-refresh signal — see advance-status-button for the
  // full rationale (same race fix, different surface).
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  const paise = rupeesStringToPaise(amount);
  const amountValid = paise !== null;
  const canSubmit = !busy && amountValid;

  async function onSubmit() {
    if (!canSubmit || paise === null) return;
    setSubmitting(true);
    setFieldErrors({});
    setGeneralError(null);
    try {
      const trimmedNumber = number.trim();
      const trimmedNotes = notes.trim();
      const res = await fetch(`/api/requests/${requestId}/quotation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          totalOrderValuePaise: paise,
          ...(trimmedNumber !== "" ? { quotationNumber: trimmedNumber } : {}),
          ...(trimmedNotes !== "" ? { notes: trimmedNotes } : {}),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        fieldErrors?: Record<string, string>;
      };
      if (!res.ok || !j.ok) {
        setFieldErrors(j.fieldErrors ?? {});
        setGeneralError(j.error ?? `Request failed (${res.status})`);
        toast.error(j.error ?? "Could not save quotation.");
        return;
      }
      toast.success(existing ? "Quotation updated." : "Quotation recorded.");
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
          <DialogTitle>
            {existing ? "Edit quotation" : "Add quotation"}
          </DialogTitle>
          <DialogDescription>
            Headline total only. {existing ? "Revisions are audited." : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="quotation-amount" className="text-sm">
              Total order value (₹) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="quotation-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="e.g. 125000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={busy}
              className="h-12 font-mono"
            />
            {fieldErrors.totalOrderValuePaise && (
              <p className="text-xs text-destructive">
                {fieldErrors.totalOrderValuePaise}
              </p>
            )}
            {!amountValid && amount.trim() !== "" && (
              <p className="text-xs text-destructive">
                Enter a positive number with at most 2 decimals.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="quotation-number" className="text-sm">
              Quotation number{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="quotation-number"
              type="text"
              autoComplete="off"
              placeholder="e.g. Q-2025-001"
              value={number}
              onChange={(e) => setNumber(e.target.value.slice(0, NUMBER_MAX))}
              disabled={busy}
              maxLength={NUMBER_MAX}
              className="h-12"
            />
            {fieldErrors.quotationNumber && (
              <p className="text-xs text-destructive">
                {fieldErrors.quotationNumber}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="quotation-notes" className="text-sm">
              Notes <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="quotation-notes"
              placeholder="Internal context — scope, exclusions, special terms…"
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
              disabled={busy}
              maxLength={NOTES_MAX}
              rows={3}
              className="resize-none"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {fieldErrors.notes && (
                  <span className="text-destructive">{fieldErrors.notes}</span>
                )}
              </span>
              <span aria-live="polite">
                {notes.length}/{NOTES_MAX}
              </span>
            </div>
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
          <Button onClick={onSubmit} disabled={!canSubmit}>
            {busy ? (
              <>
                <Icon
                  name="progress_activity"
                  size="sm"
                  className="animate-spin"
                />
                <span>Saving…</span>
              </>
            ) : existing ? (
              "Save changes"
            ) : (
              "Save quotation"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
