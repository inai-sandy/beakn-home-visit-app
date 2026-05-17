"use client";

import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

import { AssignRequestModal } from "@/components/assign-request-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

// =============================================================================
// HVA-81 + HVA-139: AssignRequestRow — request row + trigger for the
// shared AssignRequestModal.
// =============================================================================
//
// HVA-139 extracted the Dialog into components/assign-request-modal.tsx
// so /requests/[id] and /captain/requests can render the same modal
// without code duplication. This file now owns the row presentation +
// the trigger button only.
// =============================================================================

export interface AssignRequestRowProps {
  request: {
    id: string;
    customerName: string;
    customerPhone: string;
    address: string;
    bhk: string;
    interest: string[];
    createdAt: string; // ISO string from server component
    cityName: string;
  };
  execs: Array<{ id: string; fullName: string }>;
}

export function AssignRequestRow({ request, execs }: AssignRequestRowProps) {
  const [open, setOpen] = useState(false);

  const relative = formatDistanceToNow(new Date(request.createdAt), {
    addSuffix: true,
  });

  return (
    <li className="rounded-3xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-base font-semibold tracking-tight">
              {request.customerName}
            </h2>
            <Badge variant="outline" className="text-[10px]">
              {request.cityName}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {request.bhk}
            </Badge>
            <span
              className="text-xs text-muted-foreground"
              title={new Date(request.createdAt).toISOString()}
            >
              {relative}
            </span>
          </div>
          <p className="text-sm text-muted-foreground whitespace-pre-line">
            {request.address}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Icon name="phone" size="xs" />
              <span className="font-mono">{request.customerPhone}</span>
            </span>
            {request.interest.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Icon name="lightbulb" size="xs" />
                <span>{request.interest.join(", ")}</span>
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0">
          <Button
            type="button"
            onClick={() => setOpen(true)}
            disabled={execs.length === 0}
            className="h-10 px-4"
          >
            Assign
          </Button>
        </div>
      </div>

      <AssignRequestModal
        requestId={request.id}
        execs={execs}
        open={open}
        onClose={() => setOpen(false)}
      />
    </li>
  );
}
