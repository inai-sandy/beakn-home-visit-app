"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

// HVA-104: forward-only status advance button. Posts to HVA-67's
// /api/requests/[id]/status with the resolved next stage id. The button
// label is server-resolved from the next stage's name so this client
// doesn't have to know about the stage sequence — just fire-and-refresh.
//
// router.refresh() re-runs the page's server component; the timeline
// picks up the new history row and the button's nextStage props update
// naturally on the next render. No optimistic UI — the brief explicitly
// said do not optimistically update, surface server errors.

interface AdvanceStatusButtonProps {
  requestId: string;
  nextStatus: { id: string; name: string };
}

export function AdvanceStatusButton({
  requestId,
  nextStatus,
}: AdvanceStatusButtonProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  // HVA-136: useTransition keeps `isPending` true until the RSC payload
  // requested by router.refresh() is reconciled. The button stays
  // disabled across the POST + refresh window, closing the double-click
  // race that produced "FORWARD_ONLY currentSeq=4 attemptedSeq=4" when
  // an exec re-clicked before the parent re-rendered with the new
  // nextStatus.id.
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  async function onClick() {
    if (busy) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/requests/${requestId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No reason captured in HVA-104 UI — future enhancement. HVA-67's
        // schema marks reason as optional.
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
      // Server-data refresh — timeline + next-stage label update. Wrapped
      // in startTransition so the button below stays disabled until the
      // new RSC payload lands (parent re-renders with the next stage's
      // id, so the now-stale id in this component's props is replaced
      // before the user can click again).
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
    <Button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="w-full sm:w-auto h-12 px-5 text-base font-medium"
    >
      {busy ? (
        <>
          <Icon name="progress_activity" size="sm" className="animate-spin" />
          <span>Moving…</span>
        </>
      ) : (
        <>
          <Icon name="arrow_forward" size="sm" />
          <span>Move to {nextStatus.name}</span>
        </>
      )}
    </Button>
  );
}
