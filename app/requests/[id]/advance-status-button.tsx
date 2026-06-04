"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ScheduleVisitDialog } from "@/components/visit-schedule/ScheduleVisitDialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

// HVA-104 + 2026-05-26 fix: forward-only status advance.
// HVA-223 2026-06-04: the "should I open a calendar picker?" decision
// now comes from status_transitions.requires_datetime (admin-editable
// at /admin/settings/workflow/transitions) instead of the hardcoded
// VISIT_SCHEDULED check. Default seeded behavior is identical to the
// old code, but admin can now mark any transition as needing a picker.

interface AdvanceStatusButtonProps {
  requestId: string;
  nextStatus: { id: string; code: string; name: string };
  /** From status_transitions.requires_datetime for (current → next).
   *  When true, clicking the button opens the date+time picker
   *  dialog instead of one-tap advance. */
  requiresDatetime?: boolean;
}

export function AdvanceStatusButton({
  requestId,
  nextStatus,
  requiresDatetime = false,
}: AdvanceStatusButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const needsScheduleDialog = requiresDatetime;

  async function onClick() {
    if (busy) return;
    if (needsScheduleDialog) {
      setScheduleOpen(true);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/requests/${requestId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nextStatusId: nextStatus.id }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || !j.ok) {
        toast.error(j.message ?? j.error ?? `Transition failed (${res.status}).`);
        return;
      }
      toast.success(`Moved to ${nextStatus.name}`);
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? `Network error: ${err.message}` : "Network error",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="w-full sm:w-auto h-12 px-5 text-base font-medium"
      >
        {busy ? (
          <>
            <Icon name="progress_activity" size="sm" className="animate-spin" />
            <span>Saving…</span>
          </>
        ) : (
          <>
            <Icon
              name={needsScheduleDialog ? "event" : "arrow_forward"}
              size="sm"
            />
            <span>Move to {nextStatus.name}</span>
          </>
        )}
      </Button>
      {needsScheduleDialog && (
        <ScheduleVisitDialog
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
          requestId={requestId}
        />
      )}
    </>
  );
}
