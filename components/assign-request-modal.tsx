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

// =============================================================================
// HVA-139: shared "Assign Sales Executive" modal
// =============================================================================
//
// 2026-05-26: migrated to useServerMutation via createFetchAction. Same
// /assign API route; success toast still includes the exec name from the
// response payload via the hook's onSuccess data callback.
// =============================================================================

const assignRequestAction = createFetchAction<
  { requestId: string; execUserId: string; note?: string },
  { assignedExec?: { fullName: string } }
>({
  urlFor: (input) => `/api/requests/${input.requestId}/assign`,
  bodyFor: (input) =>
    JSON.stringify({ execUserId: input.execUserId, note: input.note }),
});

export interface AssignRequestModalProps {
  requestId: string;
  execs: Array<{ id: string; fullName: string }>;
  open: boolean;
  onClose: () => void;
}

export function AssignRequestModal({
  requestId,
  execs,
  open,
  onClose,
}: AssignRequestModalProps) {
  const [execId, setExecId] = useState<string>("");
  const [note, setNote] = useState("");

  const { mutate, isPending: busy } = useServerMutation(assignRequestAction, {
    onSuccess: (data) => {
      toast.success(`Assigned to ${data?.assignedExec?.fullName ?? "exec"}`);
      setExecId("");
      setNote("");
      onClose();
    },
  });

  function onConfirm() {
    if (!execId || busy) return;
    void mutate({
      requestId,
      execUserId: execId,
      note: note || undefined,
    });
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && !busy) {
      setExecId("");
      setNote("");
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md rounded-3xl">
        <DialogHeader>
          <DialogTitle>Assign sales executive</DialogTitle>
          <DialogDescription>
            Pick an exec on your team. They&apos;ll be notified
            automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`assign-exec-${requestId}`}>
              Sales executive
            </Label>
            <Select
              value={execId || undefined}
              onValueChange={setExecId}
              disabled={busy || execs.length === 0}
            >
              <SelectTrigger
                id={`assign-exec-${requestId}`}
                className="h-12 w-full rounded-input"
              >
                <SelectValue
                  placeholder={
                    execs.length === 0
                      ? "No execs available"
                      : "Select an exec"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {execs.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor={`assign-note-${requestId}`}>Note (optional)</Label>
            <Textarea
              id={`assign-note-${requestId}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Anything the exec should know — recent contact, urgency, etc."
              disabled={busy}
              className="rounded-input"
            />
          </div>
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
          <Button
            type="button"
            onClick={onConfirm}
            disabled={busy || !execId}
          >
            {busy ? (
              <>
                <Icon
                  name="progress_activity"
                  size="sm"
                  className="animate-spin"
                />
                <span>Assigning…</span>
              </>
            ) : (
              "Confirm Assign"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
