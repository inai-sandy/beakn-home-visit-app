'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { formatInrFromPaise } from '@/lib/money';
import { cn } from '@/lib/utils';

import { DispatchDialog } from '../../../_components/DispatchDialog';

// =============================================================================
// HVA-242 (HVA-231 Phase 4): per-order items table with inline dispatch
// =============================================================================
//
// Replaces the inline server-rendered items table on /support/orders/[id]
// with a client component that:
//   - shows checkboxes on rows where qty_remaining > 0 (fully done rows
//     show a "Done" badge instead)
//   - exposes a sticky "Dispatch selected (N)" bar at the bottom of the
//     section once anything is checked
//   - opens the existing DispatchDialog (reused from /support queue)
//     pre-filled with the checked rows
//   - on success: router.refresh() so items + dispatch history both update
// =============================================================================

const PRIORITY_LABEL: Record<'low' | 'med' | 'high', string> = {
  low: 'Low',
  med: 'Medium',
  high: 'High',
};

const PRIORITY_TONE: Record<'low' | 'med' | 'high', string> = {
  low: 'bg-muted text-muted-foreground',
  med: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  high: 'bg-rose-500/15 text-rose-700 border-rose-500/30',
};

export interface DispatchTableItem {
  id: string;
  productName: string;
  productSku: string | null;
  quantityTotal: number;
  quantityDispatched: number;
  quantityRemaining: number;
  unitPricePaise: number;
  priority: 'low' | 'med' | 'high';
  targetDispatchDate: string | null;
}

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

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No line items recorded yet — exec / captain needs to break the
        quotation into products first.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground bg-muted/30">
              <tr>
                {canDispatch && (
                  <th className="px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={toggleAll}
                      disabled={dispatchableIds.length === 0}
                      aria-label={
                        allSelected ? 'Unselect all' : 'Select all'
                      }
                    />
                  </th>
                )}
                <th className="text-left px-3 py-2 font-medium">Product</th>
                <th className="text-right px-3 py-2 font-medium">Total</th>
                <th className="text-right px-3 py-2 font-medium">Done</th>
                <th className="text-right px-3 py-2 font-medium">Left</th>
                <th className="text-left px-3 py-2 font-medium">Priority</th>
                <th className="text-left px-3 py-2 font-medium">Target</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const isDone = it.quantityRemaining === 0;
                const isSelected = selected.has(it.id);
                return (
                  <tr
                    key={it.id}
                    className={cn('border-t', isSelected && 'bg-primary/5')}
                  >
                    {canDispatch && (
                      <td className="px-3 py-2">
                        {isDone ? (
                          <Badge
                            variant="outline"
                            className="text-[9px] bg-emerald-500/10 text-emerald-700 border-emerald-500/30"
                          >
                            Done
                          </Badge>
                        ) : (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRow(it.id)}
                            aria-label={`Select ${it.productName}`}
                          />
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2">
                      <div className="font-medium">{it.productName}</div>
                      {it.productSku && (
                        <div className="text-[11px] font-mono text-muted-foreground">
                          {it.productSku}
                        </div>
                      )}
                      <div className="text-[11px] text-muted-foreground">
                        Unit {formatInrFromPaise(it.unitPricePaise)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {it.quantityTotal}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {it.quantityDispatched}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">
                      {it.quantityRemaining}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px]',
                          PRIORITY_TONE[it.priority],
                        )}
                      >
                        {PRIORITY_LABEL[it.priority]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {it.targetDispatchDate ?? '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

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
