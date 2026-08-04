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
  /** HVA-314: why this transition cannot be taken right now, or null when it
   *  can. Set when status_transitions.requires_quotation is on and the
   *  request has no quotation row — the engine would answer
   *  QUOTATION_REQUIRED.
   *
   *  Rendered as a DISABLED button carrying the reason, deliberately NOT
   *  hidden: a control that silently disappears is what produced the "it was
   *  there before, now it's gone" reports. The exec should see that the step
   *  exists and why it isn't available. */
  blockedReason?: string | null;
}

export function AdvanceStatusButton({
  requestId,
  nextStatus,
  requiresDatetime = false,
  blockedReason = null,
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

  // HVA-314: blocked → a disabled button that states the reason, plus the
  // reason as helper text beneath it (a `title` alone is invisible on touch,
  // and this page is walked on a phone).
  if (blockedReason) {
    return (
      <div className="w-full sm:w-auto">
        <Button
          type="button"
          disabled
          className="w-full sm:w-auto h-12 px-5 text-base font-medium"
        >
          <Icon name="lock" size="sm" />
          <span>Move to {nextStatus.name}</span>
        </Button>
        <p className="mt-1.5 text-sm text-muted-foreground">{blockedReason}</p>
      </div>
    );
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
          nextStatus={nextStatus}
        />
      )}
    </>
  );
}
