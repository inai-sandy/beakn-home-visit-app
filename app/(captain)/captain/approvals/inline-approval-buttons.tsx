"use client";

import { useState } from "react";

import { ApproveRequestModal } from "@/components/approve-request-modal";
import { RejectRequestModal } from "@/components/reject-request-modal";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

// =============================================================================
// HVA-137: inline Approve + Reject triggers for /captain/approvals rows
// =============================================================================
//
// Two side-by-side trigger buttons. Each opens the shared modal used
// by /requests/[id] so behaviour is identical across surfaces.
// =============================================================================

export interface InlineApprovalButtonsProps {
  requestId: string;
  customerName: string;
}

export function InlineApprovalButtons({
  requestId,
  customerName,
}: InlineApprovalButtonsProps) {
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setApproveOpen(true);
          }}
          className="h-9 bg-emerald-700 hover:bg-emerald-800 text-white"
        >
          <Icon name="check_circle" size="xs" />
          <span>Approve</span>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            setRejectOpen(true);
          }}
          className="h-9 border-destructive/60 text-destructive hover:bg-destructive/10"
        >
          <Icon name="undo" size="xs" />
          <span>Reject</span>
        </Button>
      </div>
      <ApproveRequestModal
        requestId={requestId}
        customerName={customerName}
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
      />
      <RejectRequestModal
        requestId={requestId}
        customerName={customerName}
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
      />
    </>
  );
}
