import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

import type {
  FinanceListSort,
  FinanceOrderRow,
  FinanceSection,
} from '@/lib/captain/finance-queries';
import type { PageRange } from '@/lib/pagination';

import { FinanceListPaginationNav } from './FinanceListPaginationNav';
import { FinanceListSortToggle } from './FinanceListSortToggle';

// =============================================================================
// PR12 2026-05-26: paginated finance order list
// =============================================================================
//
// Two layouts on the same data:
//   - Desktop (lg+): table
//   - Mobile (< lg):  card stack
//
// Each row links to /requests/[id] (existing detail page). Outstanding
// renders amber when positive, emerald when zero, rose when negative
// (customer credit). Age days shown only when > 0 to avoid noise on
// brand-new quotations.
// =============================================================================

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

function outstandingTone(p: number): string {
  if (p < 0) return 'text-rose-600 dark:text-rose-400';
  if (p === 0) return 'text-emerald-600 dark:text-emerald-400';
  if (p < 50000_00) return 'text-amber-700 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}

function isPipelineSeq(seq: number): boolean {
  return seq === 5;
}

function stageLabel(stageName: string): string {
  return stageName.replace(/_/g, ' ').toLowerCase();
}

interface Props {
  rows: FinanceOrderRow[];
  pageRange: PageRange;
  section: FinanceSection;
  currentSort: FinanceListSort;
}

export function FinanceOrderList({
  rows,
  pageRange,
  section,
  currentSort,
}: Props) {
  if (pageRange.total === 0) {
    return (
      <section
        aria-label="Orders"
        className="rounded-3xl border bg-muted/40 p-10 text-center"
      >
        <Icon
          name="receipt_long"
          size="lg"
          className="text-muted-foreground/60 mx-auto"
        />
        <p className="text-sm text-muted-foreground mt-3">
          {section === 'pipeline'
            ? 'No quotations awaiting confirmation match the current filter.'
            : section === 'order_book'
              ? 'No confirmed orders match the current filter.'
              : 'No quotations or orders match the current filter.'}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Orders"
      className="rounded-3xl border bg-card shadow-sm overflow-hidden"
    >
      <header className="flex items-center justify-between gap-3 px-5 pt-5 pb-3 flex-wrap">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold tracking-tight">
            Orders &amp; quotations
          </h2>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            Showing {pageRange.from}–{pageRange.to} of {pageRange.total}
          </p>
        </div>
        <FinanceListSortToggle currentSort={currentSort} />
      </header>

      {/* Mobile cards */}
      <ul className="lg:hidden space-y-2 p-3 pt-0">
        {rows.map((r) => (
          <li key={r.requestId}>
            <Link
              href={`/requests/${r.requestId}`}
              className="block rounded-2xl border bg-card hover:bg-muted/40 transition-colors p-4 space-y-2"
            >
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <p className="text-sm font-semibold tracking-tight">
                  {r.customerName}
                </p>
                <Badge variant="outline" className="text-[10px] capitalize">
                  {isPipelineSeq(r.sequenceNumber) ? 'Quotation' : 'Order'}
                </Badge>
              </div>
              <div className="text-[11px] text-muted-foreground capitalize">
                {stageLabel(r.stageName)} · {r.cityName}
                {r.execName ? ` · ${r.execName}` : ''}
                {r.ageDays > 0 ? ` · ${r.ageDays}d old` : ''}
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Order
                  </p>
                  <p className="font-mono tabular-nums">
                    {formatRupees(r.orderValuePaise)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Received
                  </p>
                  <p className="font-mono tabular-nums">
                    {formatRupees(r.receivedPaise)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Outstanding
                  </p>
                  <p
                    className={cn(
                      'font-mono tabular-nums',
                      outstandingTone(r.outstandingPaise),
                    )}
                  >
                    {formatRupees(r.outstandingPaise)}
                  </p>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {/* Desktop table */}
      <div className="hidden lg:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b">
              <th className="px-5 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Exec</th>
              <th className="px-3 py-2 font-medium">Stage</th>
              <th className="px-3 py-2 font-medium text-right">Order</th>
              <th className="px-3 py-2 font-medium text-right">Received</th>
              <th className="px-3 py-2 font-medium text-right">Outstanding</th>
              <th className="px-3 py-2 font-medium text-right">Age</th>
              <th className="px-5 py-2 w-8" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.requestId}
                className="border-b last:border-0 hover:bg-muted/30 transition-colors"
              >
                <td className="px-5 py-3">
                  <Link
                    href={`/requests/${r.requestId}`}
                    className="font-medium hover:underline"
                  >
                    {r.customerName}
                  </Link>
                  <p className="text-[11px] text-muted-foreground">
                    {r.cityName}
                  </p>
                </td>
                <td className="px-3 py-3 text-xs">{r.execName ?? '—'}</td>
                <td className="px-3 py-3">
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {stageLabel(r.stageName)}
                  </Badge>
                </td>
                <td className="px-3 py-3 text-right font-mono tabular-nums">
                  {formatRupees(r.orderValuePaise)}
                </td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-muted-foreground">
                  {formatRupees(r.receivedPaise)}
                </td>
                <td
                  className={cn(
                    'px-3 py-3 text-right font-mono tabular-nums font-semibold',
                    outstandingTone(r.outstandingPaise),
                  )}
                >
                  {formatRupees(r.outstandingPaise)}
                </td>
                <td className="px-3 py-3 text-right text-xs text-muted-foreground tabular-nums">
                  {r.ageDays > 0 ? `${r.ageDays}d` : '—'}
                </td>
                <td className="px-5 py-3 text-right">
                  <Link
                    href={`/requests/${r.requestId}`}
                    aria-label={`Open ${r.customerName}`}
                  >
                    <Icon
                      name="chevron_right"
                      size="sm"
                      className="text-muted-foreground"
                    />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageRange.totalPages > 1 && (
        <div className="px-5 py-3 border-t">
          <FinanceListPaginationNav pageRange={pageRange} />
        </div>
      )}
    </section>
  );
}
