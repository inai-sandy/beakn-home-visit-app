'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useServerMutation } from '@/lib/hooks/use-server-mutation';

import { addDispatchAction } from '../_actions/addDispatch';

// =============================================================================
// HVA-238 (HVA-231 Phase 2 PR-A): DispatchDialog — multi-item dispatch form
// HVA-242 — generalised so both /support queue and /support/orders/[id]
// can hand it rows. Accepts the minimal `DispatchableItem` shape; callers
// build their own rows.
// =============================================================================
//
// Pre-populated with one or more selected items. Each item gets a qty
// input (max = qty_remaining for that item). On submit:
//   - addDispatchAction runs
//   - On success: toast + onSuccess() (refreshes the queue)
//   - On failure: inline error + keep dialog open so the user can fix
// =============================================================================

export interface DispatchableItem {
  lineItemId: string;
  productName: string;
  /** Short context line shown under the product name; e.g.
   *  "Ravi Kumar · Hyderabad · 3 of 5 left" on the queue, just
   *  "3 of 5 left" on the per-order detail page. */
  contextLine: string;
  quantityRemaining: number;
}

interface Props {
  items: DispatchableItem[];
  onClose: () => void;
  onSuccess: () => void;
}

export function DispatchDialog({ items, onClose, onSuccess }: Props) {
  // qty per line item, keyed by lineItemId. Defaults to qty_remaining
  // (most common case: full-dispatch).
  const [qtyById, setQtyById] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const it of items) init[it.lineItemId] = String(it.quantityRemaining);
    return init;
  });
  const [notes, setNotes] = useState('');
  const [generalError, setGeneralError] = useState<string | null>(null);

  const mutation = useServerMutation(addDispatchAction, {
    successMessage: 'Dispatch recorded',
    onSuccess: () => {
      onSuccess();
    },
    onError: (err) => {
      setGeneralError(err);
    },
    suppressErrorToast: true,
  });

  const busy = mutation.isPending;

  const parsed = items.map((it) => {
    const raw = qtyById[it.lineItemId] ?? '';
    const qty = Number.parseInt(raw, 10);
    const valid =
      Number.isFinite(qty) && qty > 0 && qty <= it.quantityRemaining;
    return { item: it, qty, valid };
  });
  const canSubmit = !busy && parsed.every((p) => p.valid);

  function onSubmit() {
    if (!canSubmit) return;
    setGeneralError(null);
    void mutation.mutate({
      items: parsed.map((p) => ({ lineItemId: p.item.lineItemId, qty: p.qty })),
      notes: notes.trim() || undefined,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-xl rounded-3xl">
        <DialogHeader>
          <DialogTitle>Dispatch items</DialogTitle>
          <DialogDescription>
            Enter the quantity you&apos;re dispatching for each item. Default
            is the full remaining quantity — adjust for partial shipments.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {items.map((it) => {
            const raw = qtyById[it.lineItemId] ?? '';
            const qty = Number.parseInt(raw, 10);
            const valid = Number.isFinite(qty) && qty > 0 && qty <= it.quantityRemaining;
            return (
              <div
                key={it.lineItemId}
                className="rounded-xl border bg-muted/20 px-3 py-2 space-y-1"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {it.productName}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {it.contextLine}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`qty-${it.lineItemId}`} className="text-xs">
                      Qty
                    </Label>
                    <Input
                      id={`qty-${it.lineItemId}`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={it.quantityRemaining}
                      value={raw}
                      onChange={(e) =>
                        setQtyById((prev) => ({
                          ...prev,
                          [it.lineItemId]: e.target.value.replace(/\D/g, ''),
                        }))
                      }
                      disabled={busy}
                      className="h-9 w-20 font-mono"
                    />
                  </div>
                </div>
                {!valid && raw.length > 0 && (
                  <p className="text-[11px] text-destructive">
                    Quantity must be between 1 and {it.quantityRemaining}.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="space-y-2 pt-2">
          <Label htmlFor="dispatch-notes" className="text-sm">
            Notes <span className="text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="dispatch-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
            placeholder="Tracking ID, courier name, comments…"
            disabled={busy}
            rows={2}
            className="resize-none"
          />
        </div>

        {generalError && (
          <div
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive border border-destructive/30"
          >
            {generalError}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!canSubmit}>
            {busy ? (
              <>
                <Icon name="progress_activity" size="sm" className="animate-spin" />
                <span>Recording…</span>
              </>
            ) : (
              `Dispatch ${items.length} ${items.length === 1 ? 'item' : 'items'}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
