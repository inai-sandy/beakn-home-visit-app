'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { OrderDispatchState } from '@/lib/support/orders-queries';

import { Pagination } from '../../../_components/Pagination';
import { SortableColumnHeader } from '../../../_components/SortableColumnHeader';

// =============================================================================
// HVA-245: Orders list table on /support/orders
// =============================================================================

interface OrdersRow {
  requestId: string;
  customerName: string;
  customerPhone: string;
  cityName: string;
  statusStageName: string;
  itemsCount: number;
  qtyTotal: number;
  qtyDispatched: number;
  qtyRemaining: number;
  lastActivityIso: string;
  dispatchState: OrderDispatchState;
  ageDays: number;
}

interface Props {
  rows: OrdersRow[];
  initialSearch: string;
  page: number;
  pageSize: number;
  totalCount: number;
}

const STATE_LABEL: Record<OrderDispatchState, string> = {
  pending: 'Pending',
  in_progress: 'In-progress',
  done: 'Done',
};

const STATE_TONE: Record<OrderDispatchState, string> = {
  pending: 'bg-amber-500/10 text-amber-700 border-amber-500/30',
  in_progress: 'bg-sky-500/10 text-sky-700 border-sky-500/30',
  done: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30',
};

function daysAgoLabel(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export function OrdersListTable({
  rows,
  initialSearch,
  page,
  pageSize,
  totalCount,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // eslint-disable-next-line no-restricted-syntax -- HVA-149: URL push not a server mutation
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(initialSearch);

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
      params.delete('page');
      const next = params.toString();
      startTransition(() => {
        router.push(next ? `${pathname}?${next}` : pathname);
      });
    }, 300);
    return () => clearTimeout(id);
  }, [search, initialSearch, pathname, router, searchParams]);

  if (rows.length === 0 && initialSearch.trim().length === 0) {
    return (
      <div className="rounded-3xl border bg-muted/40 p-10 text-center space-y-3">
        <Icon
          name="receipt_long"
          size="lg"
          className="text-muted-foreground/70 mx-auto"
        />
        <p className="text-sm text-muted-foreground">
          No orders at ORDER_CONFIRMED or beyond yet.
        </p>
        <p className="text-xs text-muted-foreground/80">
          As execs confirm orders they&apos;ll appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          type="search"
          placeholder="Search by customer, phone, or city"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10 max-w-sm"
          aria-label="Search orders"
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-3xl border bg-muted/40 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No orders match &ldquo;{initialSearch}&rdquo;.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground bg-muted/30">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">
                    <SortableColumnHeader sortKey="customer" label="Customer" />
                  </th>
                  <th className="text-right px-3 py-2 font-medium">Items</th>
                  <th className="text-right px-3 py-2 font-medium">Qty done / total</th>
                  <th className="text-left px-3 py-2 font-medium">
                    <SortableColumnHeader sortKey="state" label="State" />
                  </th>
                  <th className="text-left px-3 py-2 font-medium">Stage</th>
                  <th className="text-left px-3 py-2 font-medium">
                    <SortableColumnHeader sortKey="activity" label="Last activity" defaultDir="desc" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.requestId} className="border-t">
                    <td className="px-3 py-2">
                      <Link
                        href={`/support/orders/${row.requestId}`}
                        className="block hover:underline focus:underline"
                      >
                        <div className="font-medium">{row.customerName}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {row.cityName} · {row.customerPhone}
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {row.itemsCount}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {row.qtyDispatched}
                      <span className="text-muted-foreground"> / {row.qtyTotal}</span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant="outline"
                        className={cn('text-[10px]', STATE_TONE[row.dispatchState])}
                      >
                        {STATE_LABEL[row.dispatchState]}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {row.statusStageName}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground text-xs">
                      {daysAgoLabel(row.ageDays)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isPending && (
        <p className="text-xs text-muted-foreground">Refreshing…</p>
      )}

      <Pagination page={page} pageSize={pageSize} totalCount={totalCount} />
    </div>
  );
}
