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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  REASON_REQUIRES_NOTE,
  REJECTION_REASONS,
  REJECTION_REASON_CODES,
  type RejectionReason,
} from "@/lib/rejection-reasons";

// =============================================================================
// HVA-69: Mark Customer Rejected — destructive action button + dialog
// =============================================================================
//
// Renders alongside the other request-detail action buttons at any
// non-terminal stage. Page.tsx is the source of truth for visibility —
// this component just renders + handles the modal interaction.
//
// Modal:
//   - REQUIRED Reason dropdown (6 enum codes from lib/rejection-reasons.ts)
//   - OPTIONAL note textarea (max 500 chars; REQUIRED with min 10 when
//     reason is OTHER — server enforces, but we mirror client-side to
//     keep the affordance honest)
//   - Cancel (secondary) + Mark Rejected (destructive)
// =============================================================================

const NOTE_MAX = 500;
const OTHER_NOTE_MIN = 10;

export function MarkCustomerRejectedButton({
  requestId,
}: {
  requestId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="w-full sm:w-auto h-12 px-5 text-base font-medium border-destructive text-destructive hover:bg-destructive/10"
      >
        <Icon name="cancel" size="sm" />
        <span>Mark Customer Rejected</span>
      </Button>
      {open && (
        <ConfirmDialog requestId={requestId} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function ConfirmDialog({
  requestId,
  onClose,
}: {
  requestId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState<RejectionReason | "">("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  // HVA-136: refresh-in-flight signal so the dialog stays inert until
  // the page's RSC payload is reconciled.
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  const reasonRequiresNote =
    reason !== "" && REASON_REQUIRES_NOTE.has(reason);
  const noteTrimmedLen = note.trim().length;
  const noteShortForOther = reasonRequiresNote && noteTrimmedLen < OTHER_NOTE_MIN;
  // "Mark Rejected" is gated client-side: must pick a reason; if OTHER,
  // note must be ≥10 chars. Server re-validates either way.
  const canSubmit = !busy && reason !== "" && !noteShortForOther;

  async function onConfirm() {
    if (!canSubmit) return;
    setSubmitting(true);
    setFieldErrors({});
    setGeneralError(null);
    try {
      const trimmed = note.trim();
      const res = await fetch(
        `/api/requests/${requestId}/mark-customer-rejected`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason,
            ...(trimmed !== "" ? { note: trimmed } : {}),
          }),
        },
      );
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        fieldErrors?: Record<string, string>;
      };
      if (!res.ok || !j.ok) {
        setFieldErrors(j.fieldErrors ?? {});
        setGeneralError(j.error ?? `Request failed (${res.status})`);
        toast.error(j.error ?? "Could not mark rejected.");
        return;
      }
      toast.success("Marked rejected — request is now closed.");
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
          <DialogTitle>Mark request as customer-rejected?</DialogTitle>
          <DialogDescription>
            This will close the request. The customer can re-engage later via a
            new request, but this one will be marked terminal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rejection-reason" className="text-sm">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Select
              value={reason || undefined}
              onValueChange={(v) => setReason(v as RejectionReason)}
              disabled={busy}
            >
              <SelectTrigger id="rejection-reason" className="h-12 w-full rounded-input">
                <SelectValue placeholder="Select a reason…" />
              </SelectTrigger>
              <SelectContent>
                {REJECTION_REASON_CODES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {REJECTION_REASONS[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.reason && (
              <p className="text-xs text-destructive">{fieldErrors.reason}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="rejection-note" className="text-sm">
              Additional context{" "}
              {reasonRequiresNote ? (
                <span className="text-destructive">*</span>
              ) : (
                <span className="text-muted-foreground">(optional)</span>
              )}
            </Label>
            <Textarea
              id="rejection-note"
              placeholder="What did the customer say specifically?"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
              disabled={busy}
              maxLength={NOTE_MAX}
              rows={3}
              className="resize-none"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {fieldErrors.note ? (
                  <span className="text-destructive">{fieldErrors.note}</span>
                ) : noteShortForOther ? (
                  <span className="text-destructive">
                    Required when reason is &ldquo;Other&rdquo; (min{" "}
                    {OTHER_NOTE_MIN} chars).
                  </span>
                ) : null}
              </span>
              <span aria-live="polite">
                {note.length}/{NOTE_MAX}
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
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={!canSubmit}
          >
            {busy ? (
              <>
                <Icon name="progress_activity" size="sm" className="animate-spin" />
                <span>Submitting…</span>
              </>
            ) : (
              "Mark Rejected"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
