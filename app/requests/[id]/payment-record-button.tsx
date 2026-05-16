"use client";

import { useRouter } from "next/navigation";
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
// HVA-70: Record an inbound payment (customer paid us)
// =============================================================================
//
// Mirrors RefundRecordButton but locked to direction='inbound'. Refund is
// a separate component because the RBAC + label rules differ (refunds
// require a label ≥ 5 chars; inbound label is optional).
// =============================================================================

const NOTES_MAX = 2000;
const REF_MAX = 255;
const LABEL_MAX = 255;

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function PaymentRecordButton({ requestId }: { requestId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-9"
      >
        <Icon name="add" size="xs" />
        <span>Add payment</span>
      </Button>
      {open && (
        <PaymentDialog requestId={requestId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function PaymentDialog({
  requestId,
  onClose,
}: {
  requestId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [mode, setMode] = useState<PaymentMode>("UPI");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  const paise = rupeesStringToPaise(amount);
  const amountValid = paise !== null;
  const canSubmit = !submitting && amountValid && paymentDate !== "";

  async function onSubmit() {
    if (!canSubmit || paise === null) return;
    setSubmitting(true);
    setFieldErrors({});
    setGeneralError(null);
    try {
      const trimmedRef = referenceNumber.trim();
      const trimmedLabel = label.trim();
      const trimmedNotes = notes.trim();
      const res = await fetch(`/api/requests/${requestId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction: "inbound",
          amountPaise: paise,
          paymentDate,
          mode,
          ...(trimmedRef !== "" ? { referenceNumber: trimmedRef } : {}),
          ...(trimmedLabel !== "" ? { label: trimmedLabel } : {}),
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
        toast.error(j.error ?? "Could not record payment.");
        return;
      }
      toast.success("Payment recorded.");
      router.refresh();
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
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Inbound — customer paid for this order.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="payment-amount" className="text-sm">
                Amount (₹) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="payment-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="e.g. 25000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={submitting}
                className="h-12 font-mono"
              />
              {fieldErrors.amountPaise && (
                <p className="text-xs text-destructive">
                  {fieldErrors.amountPaise}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-date" className="text-sm">
                Date <span className="text-destructive">*</span>
              </Label>
              <Input
                id="payment-date"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                disabled={submitting}
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
            <Label htmlFor="payment-mode" className="text-sm">
              Mode <span className="text-destructive">*</span>
            </Label>
            <Select
              value={mode}
              onValueChange={(v) => setMode(v as PaymentMode)}
              disabled={submitting}
            >
              <SelectTrigger
                id="payment-mode"
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
            <Label htmlFor="payment-reference" className="text-sm">
              Reference number{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="payment-reference"
              type="text"
              autoComplete="off"
              placeholder="UPI txn id, cheque no, …"
              value={referenceNumber}
              onChange={(e) =>
                setReferenceNumber(e.target.value.slice(0, REF_MAX))
              }
              disabled={submitting}
              maxLength={REF_MAX}
              className="h-12 font-mono"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment-label" className="text-sm">
              Label <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="payment-label"
              type="text"
              autoComplete="off"
              placeholder="e.g. Advance, Final, Token money"
              value={label}
              onChange={(e) => setLabel(e.target.value.slice(0, LABEL_MAX))}
              disabled={submitting}
              maxLength={LABEL_MAX}
              className="h-12"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="payment-notes" className="text-sm">
              Notes <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="payment-notes"
              placeholder="Additional context…"
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, NOTES_MAX))}
              disabled={submitting}
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
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit}>
            {submitting ? (
              <>
                <Icon
                  name="progress_activity"
                  size="sm"
                  className="animate-spin"
                />
                <span>Saving…</span>
              </>
            ) : (
              "Save payment"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
