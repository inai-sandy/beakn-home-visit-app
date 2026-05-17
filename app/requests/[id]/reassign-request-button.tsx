"use client";

import { useState } from "react";

import { ReassignRequestModal } from "@/components/reassign-request-modal";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

// =============================================================================
// HVA-140: Reassign Exec — trigger button for /requests/[id]
// =============================================================================
//
// Visible to captain-of-city / super_admin when the request has an
// exec already assigned and is in a non-Submitted, non-cancelled,
// non-terminal stage (per computeActionVisibility.showReassign).
//
// Subdued outline variant — sits alongside the forward action without
// competing visually with it. Matches HVA-141's RollbackStatusButton
// treatment.
// =============================================================================

export interface ReassignRequestButtonProps {
  requestId: string;
  customerName: string;
  currentExec: { id: string; fullName: string };
  candidates: Array<{ id: string; fullName: string }>;
}

export function ReassignRequestButton({
  requestId,
  customerName,
  currentExec,
  candidates,
}: ReassignRequestButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={candidates.length === 0}
        className="w-full sm:w-auto h-11 px-4 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <Icon name="swap_horiz" size="sm" />
        <span>Reassign Exec</span>
      </Button>
      <ReassignRequestModal
        requestId={requestId}
        customerName={customerName}
        currentExec={currentExec}
        candidates={candidates}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
