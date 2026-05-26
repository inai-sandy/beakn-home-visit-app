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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createFetchAction } from "@/lib/api/fetch-action";
import { useServerMutation } from "@/lib/hooks/use-server-mutation";
import { cn } from "@/lib/utils";

// =============================================================================
// HVA-140: shared "Reassign Sales Executive" modal
// =============================================================================
//
// 2026-05-26: migrated to useServerMutation via createFetchAction.
// =============================================================================

const REASON_MIN = 50;
const REASON_MAX = 500;

const reassignRequestAction = createFetchAction<
  { requestId: string; newExecUserId: string; reason: string },
  { newExec?: { fullName: string } }
>({
  urlFor: (input) => `/api/requests/${input.requestId}/reassign`,
  bodyFor: (input) =>
    JSON.stringify({
      newExecUserId: input.newExecUserId,
      reason: input.reason,
    }),
});

export interface ReassignRequestModalProps {
  requestId: string;
  customerName: string;
  /** Read-only display of the current exec for orientation. */
  currentExec: { id: string; fullName: string };
  /** Captain's team excluding the current exec — the picker options. */
  candidates: Array<{ id: string; fullName: string }>;
  open: boolean;
  onClose: () => void;
}

export function ReassignRequestModal({
  requestId,
  customerName,
  currentExec,
  candidates,
  open,
  onClose,
}: ReassignRequestModalProps) {
  const [newExecId, setNewExecId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [generalError, setGeneralError] = useState<string | null>(null);

  const { mutate, isPending: busy } = useServerMutation(
    reassignRequestAction,
    {
      onSuccess: (data) => {
        toast.success(`Reassigned to ${data?.newExec?.fullName ?? "exec"}`);
        setNewExecId("");
        setReason("");
        onClose();
      },
      onError: (err) => setGeneralError(err),
    },
  );

  const trimmed = reason.trim();
  const reasonValid =
    trimmed.length >= REASON_MIN && trimmed.length <= REASON_MAX;
  const canSubmit = !busy && newExecId !== "" && reasonValid;

  function onConfirm() {
    if (!canSubmit) return;
    setGeneralError(null);
    void mutate({ requestId, newExecUserId: newExecId, reason: trimmed });
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !busy) {
      setNewExecId("");
      setReason("");
      setGeneralError(null);
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Reassign {customerName}&apos;s visit</DialogTitle>
          <DialogDescription>
            The new exec picks up from the current stage. Both execs and
            you will get notified.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Current exec
            </p>
            <p className="text-sm font-medium">{currentExec.fullName}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`reassign-exec-${requestId}`}>
              New exec <span className="text-destructive">*</span>
            </Label>
            <Select
              value={newExecId || undefined}
              onValueChange={setNewExecId}
              disabled={busy || candidates.length === 0}
            >
              <SelectTrigger
                id={`reassign-exec-${requestId}`}
                className="h-12 w-full rounded-input"
              >
                <SelectValue
                  placeholder={
                    candidates.length === 0
                      ? "No other execs available on your team"
                      : "Pick a different exec"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`reassign-reason-${requestId}`}>
              Reason <span className="text-destructive">*</span>
              <span className="text-muted-foreground ml-1">
                ({REASON_MIN}–{REASON_MAX} chars)
              </span>
            </Label>
            <Textarea
              id={`reassign-reason-${requestId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX))}
              placeholder="e.g. Veera is on leave tomorrow; transferring continuity of the installation work to Vishnu."
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
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={!canSubmit}>
            {busy ? (
              <>
                <Icon
                  name="progress_activity"
                  size="sm"
                  className="animate-spin"
                />
                <span>Reassigning…</span>
              </>
            ) : (
              "Reassign"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
