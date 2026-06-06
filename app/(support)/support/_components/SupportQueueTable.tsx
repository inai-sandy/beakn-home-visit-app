'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { formatInrFromPaise } from '@/lib/money';
import { cn } from '@/lib/utils';

import { DispatchDialog } from './DispatchDialog';

// =============================================================================
// HVA-238 (HVA-231 Phase 2 PR-A): SupportQueueTable — main /support view
// =============================================================================
//
// Server hands the already-filtered + sorted rows; this component owns:
//   - debounced search input (URL-driven via ?q=)
//   - row selection (checkboxes) for multi-item dispatch
//   - "Dispatch selected" CTA at top + per-row Dispatch button
//   - DispatchDialog modal
//
// No pagination in v1 — query caps at 200 rows. If support actually
// hits that, we add it; meanwhile the empty / sparse state is the
// dominant case.
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

export interface SupportQueueRow {
  lineItemId: string;
  requestId: string;
  productName: string;
  productSku: string | null;
  quantityTotal: number;
  quantityRemaining: number;
  unitPricePaise: number;
  priority: 'low' | 'med' | 'high';
  targetDispatchDate: string | null;
  customerName: string;
  cityName: string;
  daysSinceOrder: number;
}

interface Props {
  rows: SupportQueueRow[];
  initialSearch: string;
}

function daysAgoLabel(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export function SupportQueueTable({ rows, initialSearch }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // eslint-disable-next-line no-restricted-syntax -- HVA-149: URL push not a server mutation
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(initialSearch);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogItems, setDialogItems] = useState<SupportQueueRow[] | null>(null);

  // Debounced URL push for ?q=
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const id = setTimeout(() => {
      const trimmed = search.trim();
      if (trimmed === initialSearch) return;
      const params = new URLSearchParams(searchParams.toString());
      if (trimmed.length === 0) {
        params.delete('q');
      } else {
        params.set('q', trimmed);
      }
      const next = params.toString();
      startTransition(() => {
        router.push(next ? `${pathname}?${next}` : pathname);
      });
    }, 300);
    return () => clearTimeout(id);
  }, [search, initialSearch, pathname, router, searchParams]);

  const allRowIds = useMemo(() => rows.map((r) => r.lineItemId), [rows]);
  const allSelected =
    allRowIds.length > 0 && allRowIds.every((id) => selected.has(id));
  const someSelected = !allSelected && allRowIds.some((id) => selected.has(id));

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allRowIds));
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

  function openDispatchForSelected() {
    const picked = rows.filter((r) => selected.has(r.lineItemId));
    if (picked.length === 0) return;
    setDialogItems(picked);
  }

  function openDispatchForSingle(row: SupportQueueRow) {
    setDialogItems([row]);
  }

  function onDispatchDone() {
    setDialogItems(null);
    setSelected(new Set());
    router.refresh();
  }

  if (rows.length === 0 && initialSearch.trim().length === 0) {
    return (
      <div className="rounded-3xl border bg-muted/40 p-10 text-center space-y-3">
        <Icon
          name="inventory_2"
          size="lg"
          className="text-muted-foreground/70 mx-auto"
        />
        <p className="text-sm text-muted-foreground">
          No orders are awaiting dispatch right now.
        </p>
        <p className="text-xs text-muted-foreground/80">
          New items will appear here as soon as an executive moves an order to
          Order Confirmed.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Input
          type="search"
          placeholder="Search by customer or product name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10 max-w-sm"
          aria-label="Search dispatch queue"
        />
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>
              Clear ({selected.size})
            </Button>
          )}
          <Button
            size="sm"
            onClick={openDispatchForSelected}
            disabled={selected.size === 0}
          >
            <Icon name="local_shipping" size="xs" />
            <span>Dispatch selected ({selected.size})</span>
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No items match &ldquo;{initialSearch}&rdquo;.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground bg-muted/30">
                <tr>
                  <th className="px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected;
                      }}
                      onChange={toggleAll}
                      aria-label={allSelected ? 'Unselect all' : 'Select all'}
                    />
                  </th>
                  <th className="text-left px-3 py-2 font-medium">Customer</th>
                  <th className="text-left px-3 py-2 font-medium">Product</th>
                  <th className="text-right px-3 py-2 font-medium">Qty left</th>
                  <th className="text-left px-3 py-2 font-medium">Priority</th>
                  <th className="text-left px-3 py-2 font-medium">Target</th>
                  <th className="text-left px-3 py-2 font-medium">Order age</th>
                  <th className="px-3 py-2" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isSelected = selected.has(row.lineItemId);
                  return (
                    <tr
                      key={row.lineItemId}
                      className={cn(
                        'border-t',
                        isSelected && 'bg-primary/5',
                      )}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(row.lineItemId)}
                          aria-label={`Select ${row.productName}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/support/orders/${row.requestId}`}
                          className="block hover:underline focus:underline"
                        >
                          <div className="font-medium">{row.customerName}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {row.cityName}
                          </div>
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          href={`/support/orders/${row.requestId}`}
                          className="block hover:underline focus:underline"
                        >
                          <div className="font-medium">{row.productName}</div>
                          {row.productSku && (
                            <div className="text-[11px] font-mono text-muted-foreground">
                              {row.productSku}
                            </div>
                          )}
                          <div className="text-[11px] text-muted-foreground">
                            Unit {formatInrFromPaise(row.unitPricePaise)}
                          </div>
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {row.quantityRemaining}
                        <span className="text-muted-foreground"> / {row.quantityTotal}</span>
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant="outline"
                          className={cn('text-[10px]', PRIORITY_TONE[row.priority])}
                        >
                          {PRIORITY_LABEL[row.priority]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">
                        {row.targetDispatchDate ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">
                        {daysAgoLabel(row.daysSinceOrder)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openDispatchForSingle(row)}
                          className="h-8 px-2"
                        >
                          Dispatch
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isPending && (
        <p className="text-xs text-muted-foreground">Refreshing…</p>
      )}

      {dialogItems && (
        <DispatchDialog
          items={dialogItems.map((r) => ({
            lineItemId: r.lineItemId,
            productName: r.productName,
            contextLine: `${r.customerName} · ${r.cityName} · ${r.quantityRemaining} of ${r.quantityTotal} left`,
            quantityRemaining: r.quantityRemaining,
          }))}
          onClose={() => setDialogItems(null)}
          onSuccess={onDispatchDone}
        />
      )}
    </div>
  );
}
