"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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

  async function onClick() {
    if (submitting) return;
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
      // Server-data refresh — timeline + next-stage label update.
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
    <Button
      type="button"
      onClick={onClick}
      disabled={submitting}
      className="w-full sm:w-auto h-12 px-5 text-base font-medium"
    >
      {submitting ? (
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
