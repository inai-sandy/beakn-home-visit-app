"use client";

import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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

// =============================================================================
// HVA-81: AssignRequestRow — request row + Assign modal
// =============================================================================
//
// Renders a single row in /captain/requests/unassigned plus the confirm-
// to-assign Dialog. Posts to /api/requests/[id]/assign with the chosen
// exec + optional note; on success removes the row by calling
// router.refresh() (the server component re-fetches the list without
// the just-assigned request).
//
// The modal uses Radix Dialog via shadcn — same primitive used by HVA-27
// and HVA-28's modals, with focus trap + escape + scrim-click handled by
// Radix natively.
// =============================================================================

export interface AssignRequestRowProps {
  request: {
    id: string;
    customerName: string;
    customerPhone: string;
    address: string;
    bhk: string;
    interest: string[];
    createdAt: string; // ISO string from server component
    cityName: string;
  };
  execs: Array<{ id: string; fullName: string }>;
}

export function AssignRequestRow({ request, execs }: AssignRequestRowProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [execId, setExecId] = useState<string>("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const relative = formatDistanceToNow(new Date(request.createdAt), {
    addSuffix: true,
  });

  async function onConfirm() {
    if (!execId || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/requests/${request.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ execUserId: execId, note: note || undefined }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        assignedExec?: { fullName: string };
      };
      if (!res.ok || !j.ok) {
        toast.error(j.error ?? `Assignment failed (${res.status}).`);
        return;
      }
      toast.success(`Assigned to ${j.assignedExec?.fullName ?? "exec"}`);
      setOpen(false);
      setExecId("");
      setNote("");
      // Re-fetches the server component; the row drops out of the list.
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? `Network error: ${err.message}` : "Network error",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <li className="rounded-3xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold tracking-tight">
              {request.customerName}
            </h2>
            <Badge variant="outline" className="text-[10px]">
              {request.cityName}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {request.bhk}
            </Badge>
            <span
              className="text-xs text-muted-foreground"
              title={new Date(request.createdAt).toISOString()}
            >
              {relative}
            </span>
          </div>
          <p className="text-sm text-muted-foreground whitespace-pre-line">
            {request.address}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Icon name="phone" size="xs" />
              <span className="font-mono">{request.customerPhone}</span>
            </span>
            {request.interest.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Icon name="lightbulb" size="xs" />
                <span>{request.interest.join(", ")}</span>
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0">
          <Button
            type="button"
            onClick={() => setOpen(true)}
            disabled={execs.length === 0}
            className="h-10 px-4"
          >
            Assign
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md rounded-3xl">
          <DialogHeader>
            <DialogTitle>Assign request</DialogTitle>
            <DialogDescription>
              Pick an exec on your team. They&apos;ll be notified
              automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`exec-${request.id}`}>Sales executive</Label>
              <Select
                value={execId || undefined}
                onValueChange={setExecId}
                disabled={submitting || execs.length === 0}
              >
                <SelectTrigger
                  id={`exec-${request.id}`}
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
              <Label htmlFor={`note-${request.id}`}>
                Note (optional)
              </Label>
              <Textarea
                id={`note-${request.id}`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Anything the exec should know — recent contact, urgency, etc."
                disabled={submitting}
                className="rounded-input"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={onConfirm}
              disabled={submitting || !execId}
            >
              {submitting ? (
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
    </li>
  );
}
