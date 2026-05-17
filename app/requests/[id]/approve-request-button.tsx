"use client";

import { useState } from "react";

import { ApproveRequestModal } from "@/components/approve-request-modal";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

// =============================================================================
// HVA-137: Approve & complete order — trigger button for /requests/[id]
// =============================================================================

export interface ApproveRequestButtonProps {
  requestId: string;
  customerName: string;
}

export function ApproveRequestButton({
  requestId,
  customerName,
}: ApproveRequestButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full sm:w-auto h-12 px-5 text-base font-medium bg-emerald-700 hover:bg-emerald-800 text-white"
      >
        <Icon name="check_circle" size="sm" />
        <span>Approve &amp; complete order</span>
      </Button>
      <ApproveRequestModal
        requestId={requestId}
        customerName={customerName}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
