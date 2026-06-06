'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { OrderDispatchState } from '@/lib/support/orders-queries';

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

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  function gotoPage(p: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (p > 1) params.set('page', String(p));
    else params.delete('page');
    const next = params.toString();
    startTransition(() => {
      router.push(next ? `${pathname}?${next}` : pathname);
    });
  }

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
        <p className="text-xs text-muted-foreground ml-auto">
          {totalCount} {totalCount === 1 ? 'order' : 'orders'}
          {totalPages > 1 && ` · page ${page} of ${totalPages}`}
        </p>
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
                  <th className="text-left px-3 py-2 font-medium">Customer</th>
                  <th className="text-right px-3 py-2 font-medium">Items</th>
                  <th className="text-right px-3 py-2 font-medium">Qty done / total</th>
                  <th className="text-left px-3 py-2 font-medium">State</th>
                  <th className="text-left px-3 py-2 font-medium">Stage</th>
                  <th className="text-left px-3 py-2 font-medium">Last activity</th>
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

      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => gotoPage(page - 1)}
            disabled={page <= 1 || isPending}
          >
            <Icon name="chevron_left" size="xs" />
            <span>Previous</span>
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => gotoPage(page + 1)}
            disabled={page >= totalPages || isPending}
          >
            <span>Next</span>
            <Icon name="chevron_right" size="xs" />
          </Button>
        </div>
      )}

      {isPending && (
        <p className="text-xs text-muted-foreground">Refreshing…</p>
      )}
    </div>
  );
}
