'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Icon } from '@/components/ui/icon';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

import type {
  FinanceOrderRow,
  FinancePaymentRow,
} from '@/lib/captain/finance-queries';

// =============================================================================
// Sandeep 2026-06-03: Finance hero tiles → clickable tabular drilldown
// =============================================================================
//
// The four hero tiles on every Finance page (Order Book / Quotation
// Pipeline / Received / Outstanding) become buttons that open this
// slide-over sheet with a sortable table of the underlying rows.
//
// Three of the tiles (Order Book / Pipeline / Outstanding) share the
// `FinanceOrderRow` shape (quotation-level rows). The fourth
// (Received) uses `FinancePaymentRow` (per-payment rows including
// refunds rendered as negative).
//
// 100-row cap per tile. The page's main filtered list below the tiles
// is still the canonical "full list" surface — the sheet is a
// quick-look summary that exists *to explain the tile number*.
// =============================================================================

export type FinanceTileKey = 'order_book' | 'pipeline' | 'received' | 'outstanding';

interface OrderTileSheetProps {
  tile: 'order_book' | 'pipeline' | 'outstanding';
  rows: FinanceOrderRow[];
  open: boolean;
  onOpenChange: (next: boolean) => void;
  /** Where the table row links lead. Defaults to `/requests/[id]`. */
  requestHref?: (requestId: string) => string;
  /** "See full list →" footer link target. Where the main filtered
   *  Finance list lives. */
  fullListHref: string;
}

interface ReceivedTileSheetProps {
  tile: 'received';
  rows: FinancePaymentRow[];
  open: boolean;
  onOpenChange: (next: boolean) => void;
  requestHref?: (requestId: string) => string;
  fullListHref: string;
}

type Props = OrderTileSheetProps | ReceivedTileSheetProps;

const TITLES: Record<FinanceTileKey, { title: string; subtitle: string }> = {
  order_book: {
    title: 'Order Book',
    subtitle:
      'Quotations on confirmed orders. Sorted by outstanding amount desc.',
  },
  pipeline: {
    title: 'Quotation Pipeline',
    subtitle:
      'Quotations submitted before the order is confirmed. Sorted by oldest first.',
  },
  received: {
    title: 'Received',
    subtitle:
      'Every payment recorded against the scoped requests. Refunds shown as negative. Sorted chronologically.',
  },
  outstanding: {
    title: 'Outstanding',
    subtitle:
      'Requests with money still owed. Sorted by outstanding amount desc.',
  },
};

function formatRupees(paise: number): string {
  const rupees = paise / 100;
  const sign = rupees < 0 ? '-' : '';
  const abs = Math.abs(rupees);
  return `${sign}${new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(abs)}`;
}

function formatPaymentDate(iso: string): string {
  // Plain date — already in IST per schema convention.
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function FinanceTileSheet(props: Props) {
  const { title, subtitle } = TITLES[props.tile];
  const hrefForRequest =
    props.requestHref ?? ((id: string) => `/requests/${id}`);

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{subtitle}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 px-4 sm:px-6 pb-6 space-y-3">
          {props.tile === 'received' ? (
            <PaymentTable
              rows={props.rows}
              hrefForRequest={hrefForRequest}
            />
          ) : (
            <OrderTable
              tile={props.tile}
              rows={
                props.tile === 'outstanding'
                  ? props.rows.filter((r) => r.outstandingPaise > 0)
                  : props.rows
              }
              hrefForRequest={hrefForRequest}
            />
          )}

          {/* Footer action: close the sheet + scroll to the main
              filtered list section on the same page (anchor target
              `#finance-list` is set on each Finance page's list
              wrapper). Using a button + scrollIntoView rather than a
              router push since the list is on the same page — pushing
              the URL would be a no-op and leave the sheet open. */}
          <div className="pt-3 border-t">
            <button
              type="button"
              onClick={() => {
                props.onOpenChange(false);
                if (typeof window !== 'undefined') {
                  const el = document.getElementById('finance-list');
                  if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                }
              }}
              className="text-xs text-primary hover:underline inline-flex items-center gap-1"
            >
              See full list with filters and pagination
              <Icon name="arrow_downward" size="xs" />
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function OrderTable({
  tile,
  rows,
  hrefForRequest,
}: {
  tile: 'order_book' | 'pipeline' | 'outstanding';
  rows: FinanceOrderRow[];
  hrefForRequest: (id: string) => string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border bg-muted/30 p-8 text-center">
        <p className="text-sm text-muted-foreground">No rows in this group.</p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr className="border-b">
            <th className="text-left py-2 pr-3">Customer</th>
            <th className="text-left py-2 pr-3">City</th>
            <th className="text-right py-2 pr-3">Quotation</th>
            {tile !== 'pipeline' && (
              <th className="text-right py-2 pr-3">Paid</th>
            )}
            {tile !== 'pipeline' && (
              <th className="text-right py-2 pr-3">Outstanding</th>
            )}
            <th className="text-right py-2">Age</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.slice(0, 100).map((r) => (
            <tr key={r.requestId} className="hover:bg-muted/30">
              <td className="py-2 pr-3">
                <Link
                  href={hrefForRequest(r.requestId)}
                  className="text-primary hover:underline font-medium"
                >
                  {r.customerName}
                </Link>
                {r.execName && (
                  <p className="text-[11px] text-muted-foreground">
                    {r.execName}
                  </p>
                )}
              </td>
              <td className="py-2 pr-3 text-muted-foreground">{r.cityName}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {formatRupees(r.orderValuePaise)}
              </td>
              {tile !== 'pipeline' && (
                <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                  {formatRupees(r.receivedPaise)}
                </td>
              )}
              {tile !== 'pipeline' && (
                <td
                  className={cn(
                    'py-2 pr-3 text-right tabular-nums font-medium',
                    r.outstandingPaise > 0
                      ? 'text-amber-700 dark:text-amber-300'
                      : '',
                  )}
                >
                  {formatRupees(r.outstandingPaise)}
                </td>
              )}
              <td className="py-2 text-right text-[11px] text-muted-foreground tabular-nums">
                {r.ageDays}d
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 100 && (
        <p className="text-[11px] text-muted-foreground mt-2">
          Showing first 100 of {rows.length}. Use the full list for the rest.
        </p>
      )}
    </div>
  );
}

function PaymentTable({
  rows,
  hrefForRequest,
}: {
  rows: FinancePaymentRow[];
  hrefForRequest: (id: string) => string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border bg-muted/30 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No payments recorded yet.
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr className="border-b">
            <th className="text-left py-2 pr-3">Date</th>
            <th className="text-left py-2 pr-3">Customer</th>
            <th className="text-right py-2 pr-3">Amount</th>
            <th className="text-left py-2 pr-3">Mode</th>
            <th className="text-left py-2">Recorded by</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.slice(0, 100).map((p) => (
            <tr key={p.id} className="hover:bg-muted/30">
              <td className="py-2 pr-3 text-muted-foreground tabular-nums whitespace-nowrap">
                {formatPaymentDate(p.paymentDate)}
              </td>
              <td className="py-2 pr-3">
                <Link
                  href={hrefForRequest(p.requestId)}
                  className="text-primary hover:underline font-medium"
                >
                  {p.customerName}
                </Link>
                {p.execName && (
                  <p className="text-[11px] text-muted-foreground">
                    {p.execName}
                  </p>
                )}
              </td>
              <td
                className={cn(
                  'py-2 pr-3 text-right tabular-nums font-medium whitespace-nowrap',
                  p.direction === 'outbound'
                    ? 'text-rose-700 dark:text-rose-300'
                    : 'text-emerald-700 dark:text-emerald-300',
                )}
              >
                {formatRupees(p.amountPaise)}
              </td>
              <td className="py-2 pr-3 text-muted-foreground">
                <span className="inline-flex items-center gap-1 text-[11px]">
                  {p.direction === 'outbound' && (
                    <Icon name="undo" size="xs" />
                  )}
                  {p.mode}
                </span>
              </td>
              <td className="py-2 text-muted-foreground text-[11px]">
                {p.recordedByName ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 100 && (
        <p className="text-[11px] text-muted-foreground mt-2">
          Showing first 100 of {rows.length}. Use the full list for the rest.
        </p>
      )}
    </div>
  );
}

/** Tiny helper for the snapshot wrapper to track which tile is open. */
export function useFinanceTileSheetState() {
  const [openTile, setOpenTile] = useState<FinanceTileKey | null>(null);
  return {
    openTile,
    open(tile: FinanceTileKey) {
      setOpenTile(tile);
    },
    close() {
      setOpenTile(null);
    },
    isOpen(tile: FinanceTileKey) {
      return openTile === tile;
    },
  };
}
