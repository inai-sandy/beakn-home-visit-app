"use client";

import { useState } from "react";

import { AssignRequestModal } from "@/components/assign-request-modal";
import { Button } from "@/components/ui/button";

// =============================================================================
// HVA-139: inline "Assign" trigger for /captain/requests rows
// =============================================================================
//
// Used per-row in the Open bucket on /captain/requests (any row where
// statusCode === 'SUBMITTED' AND assignedExecUserId IS NULL AND
// cancelled_at IS NULL). Wraps the shared AssignRequestModal so the row
// can dispatch assignment without leaving the list view.
//
// The row's outer link is suppressed at the button via stopPropagation
// (mobile card uses a stretched-link pattern; the button sits above the
// link in z-order).
// =============================================================================

export interface InlineAssignButtonProps {
  requestId: string;
  execs: Array<{ id: string; fullName: string }>;
  /** Optional className for layout tuning per-call-site (mobile vs table). */
  className?: string;
}

export function InlineAssignButton({
  requestId,
  execs,
  className,
}: InlineAssignButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={(e) => {
          // Keep the click from bubbling to the surrounding row Link.
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
        disabled={execs.length === 0}
        className={className ?? "h-8 px-3 text-xs"}
      >
        Assign
      </Button>
      <AssignRequestModal
        requestId={requestId}
        execs={execs}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
