'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { formatInrFromPaise } from '@/lib/money';
import { cn } from '@/lib/utils';

import {
  PaymentRecordButton,
  type PaymentOptimisticHandlers,
} from './payment-record-button';
import { PaymentVoidButton } from './payment-void-button';
import { RefundRecordButton } from './refund-record-button';

// =============================================================================
// HVA-150 (opt-in pattern) + HVA-200: Payments block on /requests/[id]
// =============================================================================
//
// Carved out of the server-side CollectionSection so we can hold
// optimistic state for the Add Payment surface. Mirrors the same
// useState + merge-by-id pattern as NotesSection / PostSubmissionTasksList
// / LeadsFilterClient.
//
// Scope (deliberate):
//   - Optimistic row appears in the payments list immediately on Save
//   - Sheet/dialog closes, server action fires in background
//   - Summary block (Net received / Balance due / Overpaid) does NOT
//     reflect the optimistic row — it'd require reconstructing
//     computeCollectionSummary client-side. Tradeoff: payments list is
//     the user's primary "did it save?" signal; summary updates on the
//     next router.refresh (~200ms). Keeping summary server-rendered
//     means SSOT math survives the optimistic carve-out.
// =============================================================================

export interface PaymentRow {
  id: string;
  direction: 'inbound' | 'outbound';
  amountPaise: number;
  paymentDate: string;
  mode: string;
  label: string | null;
  referenceNumber: string | null;
  notes: string | null;
  voidedAt: Date | null;
  voidedReason: string | null;
  recordedByName: string | null;
}

interface LocalPayment extends PaymentRow {
  pending?: boolean;
}

interface Props {
  requestId: string;
  rows: PaymentRow[];
  canRecordPayment: boolean;
  canRefund: boolean;
  canVoid: boolean;
}

export function PaymentsBlock({
  requestId,
  rows: serverRows,
  canRecordPayment,
  canRefund,
  canVoid,
}: Props) {
  const [optimistic, setOptimistic] = useState<LocalPayment[]>([]);

  // Merge optimistic + server, dedup by id. Optimistic rows appear at
  // the bottom (matching server orderBy: paymentDate asc, createdAt asc
  // — new rows are typically today so they land at the end).
  const seen = new Set<string>();
  const merged: LocalPayment[] = [];
  for (const r of serverRows) {
    if (!seen.has(r.id)) {
      merged.push(r);
      seen.add(r.id);
    }
  }
  for (const o of optimistic) {
    if (!seen.has(o.id)) {
      merged.push(o);
      seen.add(o.id);
    }
  }

  const optimisticHandlers: PaymentOptimisticHandlers = {
    onAdd: (insert) => {
      const tempRow: LocalPayment = {
        id: insert.id,
        direction: 'inbound',
        amountPaise: insert.amountPaise,
        paymentDate: insert.paymentDate,
        mode: insert.mode,
        label: insert.label,
        referenceNumber: insert.referenceNumber,
        notes: insert.notes,
        voidedAt: null,
        voidedReason: null,
        recordedByName: null,
        pending: true,
      };
      setOptimistic((prev) => [...prev, tempRow]);
    },
    onReconcile: (tempId, serverPaymentId) => {
      setOptimistic((prev) =>
        prev.map((p) =>
          p.id === tempId ? { ...p, id: serverPaymentId, pending: false } : p,
        ),
      );
      setTimeout(() => {
        setOptimistic((prev) => prev.filter((p) => p.id !== serverPaymentId));
      }, 3000);
    },
    onRemove: (tempId) => {
      setOptimistic((prev) => prev.filter((p) => p.id !== tempId));
    },
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
          Payments
        </h3>
        <div className="flex gap-2 flex-wrap">
          {canRecordPayment && (
            <PaymentRecordButton
              requestId={requestId}
              optimistic={optimisticHandlers}
            />
          )}
          {canRefund && <RefundRecordButton requestId={requestId} />}
        </div>
      </div>
      {merged.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No payments recorded yet.
        </p>
      ) : (
        <ol className="space-y-2">
          {merged.map((p) => {
            const voided = p.voidedAt !== null;
            const isRefund = p.direction === 'outbound';
            return (
              <li
                key={p.id}
                className={cn(
                  'rounded-2xl border px-4 py-3',
                  voided && 'bg-muted/50 opacity-60',
                  isRefund && !voided && 'border-amber-500/40 bg-amber-500/5',
                  p.pending && 'opacity-70 pointer-events-none',
                )}
              >
                <div className="flex items-baseline justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p
                      className={cn(
                        'text-base font-semibold font-mono',
                        voided && 'line-through',
                      )}
                    >
                      {isRefund ? '−' : '+'}
                      {formatInrFromPaise(p.amountPaise)}
                    </p>
                    <Badge variant="outline" className="text-[10px]">
                      {p.mode}
                    </Badge>
                    {isRefund && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] bg-amber-500/20 text-amber-900"
                      >
                        Refund
                      </Badge>
                    )}
                    {voided && (
                      <Badge variant="destructive" className="text-[10px]">
                        Voided
                      </Badge>
                    )}
                    {p.pending && (
                      <Badge variant="secondary" className="text-[10px]">
                        Saving…
                      </Badge>
                    )}
                  </div>
                  {canVoid && !voided && !p.pending && (
                    <PaymentVoidButton
                      requestId={requestId}
                      paymentId={p.id}
                    />
                  )}
                </div>
                {p.label && (
                  <p className="text-xs mt-1 font-medium">{p.label}</p>
                )}
                {p.referenceNumber && (
                  <p className="text-xs mt-0.5 font-mono text-muted-foreground">
                    Ref: {p.referenceNumber}
                  </p>
                )}
                {p.notes && (
                  <p className="text-xs mt-1 whitespace-pre-wrap text-foreground/80">
                    {p.notes}
                  </p>
                )}
                <p className="text-[11px] mt-1 text-muted-foreground">
                  {p.paymentDate}
                  {p.recordedByName ? ` · ${p.recordedByName}` : ''}
                </p>
                {voided && p.voidedReason && (
                  <p className="text-[11px] mt-1 text-destructive">
                    <Icon
                      name="cancel"
                      size="xs"
                      className="inline align-text-bottom mr-1"
                    />
                    Voided: {p.voidedReason}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
