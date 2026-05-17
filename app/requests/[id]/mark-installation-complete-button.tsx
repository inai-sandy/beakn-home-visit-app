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
// HVA-68: Mark Installation Complete button + confirmation modal
// =============================================================================
//
// Sits next to the generic "Move to Next Stage" button on /requests/[id].
// Server-side rendering decides whether to show this — see page.tsx.
//
// Click flow:
//   1. Open dialog: title + body explaining captain will be asked to approve.
//   2. Optional textarea (label "Add a note for the captain (optional)",
//      placeholder, max 500 chars enforced client-side too — server is
//      authoritative).
//   3. "Mark Complete" submits; "Cancel" / Escape / outside-click closes.
//   4. On success: toast + router.refresh() so the page picks up the new
//      status (and removes its own button on the next render).
//   5. On failure: surface the server's `error` message in the dialog +
//      keep the dialog open so the user can retry or close.
// =============================================================================

const NOTE_MAX = 500;

export function MarkInstallationCompleteButton({
  requestId,
}: {
  requestId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
        className="w-full sm:w-auto h-12 px-5 text-base font-medium"
      >
        <Icon name="task_alt" size="sm" />
        <span>Mark Installation Complete</span>
      </Button>
      {open && (
        <ConfirmDialog
          requestId={requestId}
          onClose={() => setOpen(false)}
        />
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
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  // HVA-136: keep the dialog buttons disabled until the page's RSC
  // payload has been re-fetched, so the user can't see stale state
  // behind the closing modal.
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  async function onConfirm() {
    if (busy) return;
    setSubmitting(true);
    setGeneralError(null);
    setFieldError(null);
    try {
      const trimmed = note.trim();
      const res = await fetch(
        `/api/requests/${requestId}/mark-installation-complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(trimmed === "" ? {} : { note: trimmed }),
        },
      );
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        fieldErrors?: Record<string, string>;
      };
      if (!res.ok || !j.ok) {
        setFieldError(j.fieldErrors?.note ?? null);
        setGeneralError(j.error ?? `Request failed (${res.status})`);
        toast.error(j.error ?? "Could not mark complete.");
        return;
      }
      toast.success("Marked complete — captain will be asked to approve.");
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
          <DialogTitle>Mark installation as complete?</DialogTitle>
          <DialogDescription>
            Captain will be asked to approve. Once approved, the request is
            considered fulfilled.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="completion-note" className="text-sm">
            Add a note for the captain (optional)
          </Label>
          <Textarea
            id="completion-note"
            placeholder="e.g. All 6 switches installed, demo done with customer."
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))}
            disabled={busy}
            maxLength={NOTE_MAX}
            rows={4}
            className="resize-none"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {fieldError ? (
                <span className="text-destructive">{fieldError}</span>
              ) : null}
            </span>
            <span aria-live="polite">{note.length}/{NOTE_MAX}</span>
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
                <Icon name="progress_activity" size="sm" className="animate-spin" />
                <span>Submitting…</span>
              </>
            ) : (
              "Mark Complete"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
