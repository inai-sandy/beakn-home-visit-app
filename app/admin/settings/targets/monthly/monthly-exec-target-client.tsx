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

// =============================================================================
// MonthlyExecTargetClient
// =============================================================================
//
// Single-key admin editor. Mirrors customer-support-phone-client shape:
// inline card showing the stored value + a friendly short form
// (₹1.50L style) + Edit dialog with a rupee-input.
// =============================================================================

function formatRupees(rupees: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(rupees);
}

function formatRupeesShort(rupees: number): string {
  if (rupees >= 10_000_000) {
    return `₹${(rupees / 10_000_000).toFixed(2)}Cr`;
  }
  if (rupees >= 100_000) {
    return `₹${(rupees / 100_000).toFixed(2)}L`;
  }
  if (rupees >= 1_000) {
    return `₹${(rupees / 1_000).toFixed(1)}K`;
  }
  return `₹${rupees}`;
}

export function MonthlyExecTargetClient({
  currentRupees,
}: {
  currentRupees: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="rounded-3xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex-1 min-w-0 space-y-2">
            <h3 className="text-base font-semibold tracking-tight">
              Current monthly target
            </h3>
            <div className="flex items-baseline gap-3 flex-wrap">
              <p className="text-3xl font-bold tabular-nums tracking-tight">
                {formatRupeesShort(currentRupees)}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                exact: {formatRupees(currentRupees)}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Each exec needs to: (1) close ORDER_CONFIRMED orders worth this
              amount in the calendar month AND (2) collect this amount in
              inbound revenue (advance + order payments + any inbound).
            </p>
          </div>
          <div className="shrink-0">
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              Edit
            </Button>
          </div>
        </div>
      </div>

      {open && (
        <EditDialog
          currentRupees={currentRupees}
          onClose={() => setOpen(false)}
          onSuccess={() => {
            router.refresh();
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function EditDialog({
  currentRupees,
  onClose,
  onSuccess,
}: {
  currentRupees: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [valueStr, setValueStr] = useState(String(currentRupees));
  const [submitting, setSubmitting] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const parsed = Number.parseInt(valueStr.replace(/[, ]/g, ""), 10);
  const previewShort = Number.isFinite(parsed) ? formatRupeesShort(parsed) : "—";

  async function onSubmit() {
    setSubmitting(true);
    setFieldError(null);
    setGeneralError(null);
    try {
      const res = await fetch("/api/admin/config/monthly-exec-target", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valueRupees: parsed }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        fieldErrors?: Record<string, string>;
        changed?: boolean;
      };
      if (!res.ok || !j.ok) {
        setFieldError(j.fieldErrors?.valueRupees ?? null);
        setGeneralError(j.error ?? `Request failed (${res.status})`);
        toast.error(j.error ?? "Update failed.");
        return;
      }
      toast.success(
        j.changed === false
          ? "No change — value already set to this amount."
          : `Monthly target updated to ${formatRupeesShort(parsed)}.`,
      );
      onSuccess();
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
          <DialogTitle>Edit monthly target</DialogTitle>
          <DialogDescription>
            Whole rupees only. Common across every exec. Applies starting
            this calendar month.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label htmlFor="monthly-target">Target (₹)</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              ₹
            </span>
            <Input
              id="monthly-target"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={valueStr}
              onChange={(e) => setValueStr(e.target.value)}
              disabled={submitting}
              className="h-12 pl-7 font-mono tabular-nums"
              autoFocus
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Preview: <span className="font-semibold">{previewShort}</span>
          </p>
          {fieldError && (
            <p className="text-xs text-destructive">{fieldError}</p>
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
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={submitting}>
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
              "Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
