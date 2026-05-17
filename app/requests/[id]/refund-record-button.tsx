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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { rupeesStringToPaise } from "@/lib/money";
import {
  PAYMENT_MODE_LABELS,
  PAYMENT_MODE_VALUES,
  type PaymentMode,
} from "@/lib/payment-modes";

// =============================================================================
// HVA-70: Record an outbound payment (refund to customer)
// =============================================================================
//
// HVA-70 deviation #4: refunds are captain-of-city / super_admin only.
// Visibility gate lives in collection-section.tsx — this component just
// renders + posts. Label is REQUIRED (min 5 chars, enforced server-side).
// =============================================================================

const NOTES_MAX = 2000;
const REF_MAX = 255;
const LABEL_MAX = 255;
const LABEL_MIN = 5;

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function RefundRecordButton({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="h-9 border-amber-500/60 text-amber-700 hover:bg-amber-50"
      >
        <Icon name="undo" size="xs" />
        <span>Issue refund</span>
      </Button>
      {open && (
        <RefundDialog requestId={requestId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function RefundDialog({
  requestId,
  onClose,
}: {
  requestId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [mode, setMode] = useState<PaymentMode>("Bank Transfer");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  // HVA-136: refresh-in-flight signal, same pattern as the other
  // mutation modals on this page.
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  const paise = rupeesStringToPaise(amount);
  const amountValid = paise !== null;
  const labelTrimmed = label.trim();
  const labelValid = labelTrimmed.length >= LABEL_MIN;
  const canSubmit =
    !busy && amountValid && paymentDate !== "" && labelValid;

  async function onSubmit() {
    if (!canSubmit || paise === null) return;
    setSubmitting(true);
    setFieldErrors({});
    setGeneralError(null);
    try {
      const trimmedRef = referenceNumber.trim();
      const trimmedNotes = notes.trim();
      const res = await fetch(`/api/requests/${requestId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction: "outbound",
          amountPaise: paise,
          paymentDate,
          mode,
          label: labelTrimmed,
          ...(trimmedRef !== "" ? { referenceNumber: trimmedRef } : {}),
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
        toast.error(j.error ?? "Could not issue refund.");
        return;
      }
      toast.success("Refund recorded.");
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
          <DialogTitle>Issue refund</DialogTitle>
          <DialogDescription>
            Outbound — money returned to the customer. Captain/admin only.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="refund-amount" className="text-sm">
                Amount (₹) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="refund-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="e.g. 5000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={busy}
                className="h-12 font-mono"
              />
              {fieldErrors.amountPaise && (
                <p className="text-xs text-destructive">
                  {fieldErrors.amountPaise}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="refund-date" className="text-sm">
                Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="refund-date"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                disabled={busy}
                className="h-12"
              />
              {fieldErrors.paymentDate && (
                <p className="text-xs text-destructive">
                  {fieldErrors.paymentDate}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="refund-mode" className="text-sm">
              Mode <span className="text-destructive">*</span>
            </Label>
            <Select
              value={mode}
              onValueChange={(v) => setMode(v as PaymentMode)}
              disabled={busy}
            >
              <SelectTrigger
                id="refund-mode"
                className="h-12 w-full rounded-input"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_MODE_VALUES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {PAYMENT_MODE_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="refund-label" className="text-sm">
              Reason / label <span className="text-destructive">*</span>
            </Label>
            <Input
              id="refund-label"
              type="text"
              autoComplete="off"
              placeholder="e.g. Customer cancelled, partial refund"
              value={label}
              onChange={(e) => setLabel(e.target.value.slice(0, LABEL_MAX))}
              disabled={busy}
              maxLength={LABEL_MAX}
              className="h-12"
            />
            <p className="text-xs text-muted-foreground">
              {fieldErrors.label ? (
                <span className="text-destructive">{fieldErrors.label}</span>
              ) : !labelValid && labelTrimmed.length > 0 ? (
                <span className="text-destructive">
                  Min {LABEL_MIN} characters.
                </span>
              ) : (
                `Min ${LABEL_MIN} characters.`
              )}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="refund-reference" className="text-sm">
              Reference number{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="refund-reference"
              type="text"
              autoComplete="off"
              placeholder="UTR, cheque no, …"
              value={referenceNumber}
              onChange={(e) =>
                setReferenceNumber(e.target.value.slice(0, REF_MAX))
              }
              disabled={busy}
              maxLength={REF_MAX}
              className="h-12 font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="refund-notes" className="text-sm">
              Notes <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="refund-notes"
              placeholder="Additional context…"
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
              disabled={busy}
              maxLength={NOTES_MAX}
              rows={2}
              className="resize-none"
            />
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
            onClick={onSubmit}
            disabled={!canSubmit}
            className="border-amber-500/60 text-amber-700 hover:bg-amber-50"
          >
            {busy ? (
              <>
                <Icon
                  name="progress_activity"
                  size="sm"
                  className="animate-spin"
                />
                <span>Saving…</span>
              </>
            ) : (
              "Issue refund"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
