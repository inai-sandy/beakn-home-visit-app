"use client";

import { useState } from "react";

import { AssignRequestModal } from "@/components/assign-request-modal";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

// =============================================================================
// HVA-139: Assign Sales Executive — trigger button for /requests/[id]
// =============================================================================
//
// Visible to captain-of-city / super_admin when the request is at
// SUBMITTED (computeActionVisibility's showAssignExec). Replaces the
// generic AdvanceStatusButton that previously rendered at this stage
// and could move the request to ASSIGNED without picking an exec — the
// production bug Arjun ran into on Preethi.
//
// Click opens the shared AssignRequestModal which posts to
// /api/requests/[id]/assign (atomic exec assignment + stage advance).
// useTransition + router.refresh handling lives in the modal itself.
// =============================================================================

export interface AssignRequestButtonProps {
  requestId: string;
  execs: Array<{ id: string; fullName: string }>;
}

export function AssignRequestButton({
  requestId,
  execs,
}: AssignRequestButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        disabled={execs.length === 0}
        className="w-full sm:w-auto h-12 px-5 text-base font-medium"
      >
        <Icon name="person_add" size="sm" />
        <span>Assign Sales Executive</span>
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
