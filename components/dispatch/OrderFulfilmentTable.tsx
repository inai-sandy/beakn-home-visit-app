import { Badge } from '@/components/ui/badge';
import {
  ITEM_STATE_LABEL,
  ITEM_STATE_TONE,
  itemFulfilmentState,
  type FulfilmentItem,
} from '@/lib/dispatch/fulfilment';
import { formatInrFromPaise } from '@/lib/money';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-302: shared per-product fulfilment table (Ordered / Shipped / Pending)
// =============================================================================
//
// One presentational component, two consumers:
//
//   * /support/orders/[id] — passes `selection` so support can tick rows
//     and dispatch them (ItemsDispatchTable wraps this and owns the
//     checkbox state + sticky bar + DispatchDialog).
//
//   * /requests/[id] — exec + captain, no `selection`, fully read-only.
//     They dispatch nothing; they just need to see what's gone out.
//
// No 'use client' and no hooks: that lets the exec's server component
// render it directly while the support client component can still wrap
// it. Deliberately keeps the selection *state* out of here — the caller
// owns it, this only renders it.
//
// Responsive per CLAUDE.md: Tailwind hide/show, cards on mobile and a
// table from md up. Seven columns is unreadable on a field exec's phone,
// and the exec app is mobile-first.
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

export interface FulfilmentSelection {
  selectedIds: Set<string>;
  allSelected: boolean;
  someSelected: boolean;
  onToggleAll: () => void;
  onToggleRow: (id: string) => void;
}

interface Props {
  items: FulfilmentItem[];
  /** Support-only tick affordance. Omit entirely for the exec/captain
   *  read-only mirror — no checkbox column is rendered at all. */
  selection?: FulfilmentSelection;
}

export function OrderFulfilmentTable({ items, selection }: Props) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No line items recorded yet — the quotation still needs to be broken
        into products before anything can be dispatched.
      </p>
    );
  }

  const canSelect = selection !== undefined;

  return (
    <div className="rounded-2xl border bg-card overflow-hidden">
      {/* Mobile: one card per product. */}
      <ul className="md:hidden divide-y" aria-label="Products (mobile)">
        {items.map((item) => {
          const state = itemFulfilmentState(item);
          const isSelected = selection?.selectedIds.has(item.id) ?? false;
          const selectable = canSelect && item.quantityRemaining > 0;
          return (
            <li
              key={item.id}
              className={cn('px-4 py-3 space-y-1.5', isSelected && 'bg-primary/5')}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  {selectable && (
                    <input
                      type="checkbox"
                      className="mt-1 shrink-0"
                      checked={isSelected}
                      onChange={() => selection?.onToggleRow(item.id)}
                      aria-label={`Select ${item.productName}`}
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {item.productName}
                    </p>
                    {item.productSku && (
                      <p className="text-[11px] font-mono text-muted-foreground truncate">
                        {item.productSku}
                      </p>
                    )}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={cn('text-[10px] shrink-0', ITEM_STATE_TONE[state])}
                >
                  {ITEM_STATE_LABEL[state]}
                </Badge>
              </div>

              <p className="text-xs tabular-nums">
                <span className="font-semibold">{item.quantityDispatched}</span>
                <span className="text-muted-foreground">
                  {' '}
                  of {item.quantityTotal} shipped
                </span>
                {item.quantityRemaining > 0 && (
                  <span className="text-amber-700">
                    {' · '}
                    {item.quantityRemaining} pending
                  </span>
                )}
              </p>

              <p className="text-[11px] text-muted-foreground">
                {PRIORITY_LABEL[item.priority]} priority
                {item.targetDispatchDate ? ` · target ${item.targetDispatchDate}` : ''}
                {' · '}
                {formatInrFromPaise(item.unitPricePaise)} each
              </p>
            </li>
          );
        })}
      </ul>

      {/* Desktop: full table. */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground bg-muted/30">
            <tr>
              {canSelect && (
                <th className="px-3 py-2 w-10">
                  <input
                    type="checkbox"
                    checked={selection.allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = selection.someSelected;
                    }}
                    onChange={selection.onToggleAll}
                    disabled={items.every((i) => i.quantityRemaining <= 0)}
                    aria-label={selection.allSelected ? 'Unselect all' : 'Select all'}
                  />
                </th>
              )}
              <th className="text-left px-3 py-2 font-medium">Product</th>
              <th className="text-right px-3 py-2 font-medium">Ordered</th>
              <th className="text-right px-3 py-2 font-medium">Shipped</th>
              <th className="text-right px-3 py-2 font-medium">Pending</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-left px-3 py-2 font-medium">Priority</th>
              <th className="text-left px-3 py-2 font-medium">Target</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const state = itemFulfilmentState(item);
              const isSelected = selection?.selectedIds.has(item.id) ?? false;
              const selectable = canSelect && item.quantityRemaining > 0;
              return (
                <tr
                  key={item.id}
                  className={cn('border-t', isSelected && 'bg-primary/5')}
                >
                  {canSelect && (
                    <td className="px-3 py-2">
                      {selectable && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => selection?.onToggleRow(item.id)}
                          aria-label={`Select ${item.productName}`}
                        />
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <div className="font-medium">{item.productName}</div>
                    {item.productSku && (
                      <div className="text-[11px] font-mono text-muted-foreground">
                        {item.productSku}
                      </div>
                    )}
                    <div className="text-[11px] text-muted-foreground">
                      Unit {formatInrFromPaise(item.unitPricePaise)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {item.quantityTotal}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {item.quantityDispatched}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">
                    {item.quantityRemaining}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant="outline"
                      className={cn('text-[10px]', ITEM_STATE_TONE[state])}
                    >
                      {ITEM_STATE_LABEL[state]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant="outline"
                      className={cn('text-[10px]', PRIORITY_TONE[item.priority])}
                    >
                      {PRIORITY_LABEL[item.priority]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground text-xs">
                    {item.targetDispatchDate ?? '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
