'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { OrderFulfilmentTable } from '@/components/dispatch/OrderFulfilmentTable';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import type { FulfilmentItem } from '@/lib/dispatch/fulfilment';
import { formatInrFromPaise } from '@/lib/money';

import { DispatchDialog } from '../../../_components/DispatchDialog';

// =============================================================================
// HVA-242 (HVA-231 Phase 4): per-order items table with inline dispatch
// =============================================================================
//
// Owns the *interaction* around the items table on /support/orders/[id]:
//   - which rows are ticked
//   - the sticky "Dispatch selected (N)" bar
//   - opening DispatchDialog pre-filled with the ticked rows
//   - router.refresh() on success so items + dispatch history both update
//
// HVA-302: the table markup itself moved to the shared
// `components/dispatch/OrderFulfilmentTable` so exec + captain render the
// identical Ordered / Shipped / Pending numbers read-only on
// /requests/[id]. This component now supplies the selection config; drop
// that prop and the very same table renders read-only.
// =============================================================================

/** Re-exported for callers that already imported the row shape from here. */
export type DispatchTableItem = FulfilmentItem;

interface Props {
  items: DispatchTableItem[];
  /** True when the current viewer is a support user or super_admin.
   *  Exec + captain see the same data read-only (dispatch via support). */
  canDispatch: boolean;
}

export function ItemsDispatchTable({ items, canDispatch }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogItems, setDialogItems] = useState<DispatchTableItem[] | null>(
    null,
  );

  const dispatchableIds = useMemo(
    () => items.filter((i) => i.quantityRemaining > 0).map((i) => i.id),
    [items],
  );
  const allSelected =
    dispatchableIds.length > 0 &&
    dispatchableIds.every((id) => selected.has(id));
  const someSelected =
    !allSelected && dispatchableIds.some((id) => selected.has(id));

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(dispatchableIds));
    }
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openDispatch() {
    const picked = items.filter((i) => selected.has(i.id));
    if (picked.length === 0) return;
    setDialogItems(picked);
  }

  function onDispatchSuccess() {
    setDialogItems(null);
    setSelected(new Set());
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <OrderFulfilmentTable
        items={items}
        selection={
          canDispatch
            ? {
                selectedIds: selected,
                allSelected,
                someSelected,
                onToggleAll: toggleAll,
                onToggleRow: toggleRow,
              }
            : undefined
        }
      />

      {canDispatch && selected.size > 0 && (
        <div className="sticky bottom-2 z-20 flex items-center justify-between gap-3 rounded-2xl border bg-background/95 shadow-lg backdrop-blur px-4 py-3">
          <div className="flex items-center gap-2 text-sm">
            <Icon name="check_box" size="sm" />
            <span>
              {selected.size} item{selected.size === 1 ? '' : 's'} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </Button>
            <Button size="sm" onClick={openDispatch}>
              <Icon name="local_shipping" size="xs" />
              <span>Dispatch selected ({selected.size})</span>
            </Button>
          </div>
        </div>
      )}

      {dialogItems && (
        <DispatchDialog
          items={dialogItems.map((it) => ({
            lineItemId: it.id,
            productName: it.productName,
            contextLine: `${it.quantityRemaining} of ${it.quantityTotal} left · ${formatInrFromPaise(it.unitPricePaise)} each`,
            quantityRemaining: it.quantityRemaining,
          }))}
          onClose={() => setDialogItems(null)}
          onSuccess={onDispatchSuccess}
        />
      )}
    </div>
  );
}
