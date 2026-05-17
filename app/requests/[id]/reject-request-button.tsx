"use client";

import { useState } from "react";

import { RejectRequestModal } from "@/components/reject-request-modal";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

// =============================================================================
// HVA-137: Request changes (reject) — trigger button for /requests/[id]
// =============================================================================

export interface RejectRequestButtonProps {
  requestId: string;
  customerName: string;
}

export function RejectRequestButton({
  requestId,
  customerName,
}: RejectRequestButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        className="w-full sm:w-auto h-12 px-5 text-base font-medium border-destructive/60 text-destructive hover:bg-destructive/10"
      >
        <Icon name="undo" size="sm" />
        <span>Request changes</span>
      </Button>
      <RejectRequestModal
        requestId={requestId}
        customerName={customerName}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
