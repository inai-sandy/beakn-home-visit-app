import Link from 'next/link';

import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

import type {
  FinanceOrderRow,
  FinancePaymentRow,
} from '@/lib/captain/finance-queries';

// =============================================================================
// Sandeep 2026-06-03 follow-up: Finance tile detail tables (full page)
// =============================================================================
//
// Same data shapes the deprecated FinanceTileSheet used — but rendered
// as standalone tables on dedicated /collections/[tile] routes so the
// admin / captain / exec gets a real page (URL, back button, browser
// history, deep link, copy / share).
//
// Two flavours:
//   - <OrderDetailTable>   for Order Book / Pipeline / Outstanding
//   - <PaymentDetailTable> for Received (refunds rendered negative)
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

function formatPaymentDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

interface OrderDetailTableProps {
  variant: 'order_book' | 'pipeline' | 'outstanding';
  rows: FinanceOrderRow[];
  /** Where each row's customer name links. Defaults to /requests/[id]. */
  requestHref?: (requestId: string) => string;
}

export function OrderDetailTable({
  variant,
  rows,
  requestHref,
}: OrderDetailTableProps) {
  const hrefForRequest =
    requestHref ?? ((id: string) => `/requests/${id}`);

  const filtered =
    variant === 'outstanding' ? rows.filter((r) => r.outstandingPaise > 0) : rows;

  if (filtered.length === 0) {
    return (
      <div className="rounded-3xl border bg-muted/30 p-12 text-center">
        <p className="text-sm text-muted-foreground">
          {variant === 'pipeline'
            ? 'No quotations awaiting confirmation.'
            : variant === 'outstanding'
              ? 'Nothing outstanding right now.'
              : 'No confirmed orders.'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-3xl border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40">
            <tr>
              <th className="text-left py-2.5 px-4">Customer</th>
              <th className="text-left py-2.5 px-4">City</th>
              <th className="text-left py-2.5 px-4">Exec</th>
              <th className="text-left py-2.5 px-4">Stage</th>
              <th className="text-right py-2.5 px-4">Quotation</th>
              {variant !== 'pipeline' && (
                <th className="text-right py-2.5 px-4">Paid (net)</th>
              )}
              {variant !== 'pipeline' && (
                <th className="text-right py-2.5 px-4">Outstanding</th>
              )}
              <th className="text-right py-2.5 px-4">Age</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map((r) => (
              <tr key={r.requestId} className="hover:bg-muted/30">
                <td className="py-3 px-4">
                  <Link
                    href={hrefForRequest(r.requestId)}
                    className="text-primary hover:underline font-medium"
                  >
                    {r.customerName}
                  </Link>
                  <p className="text-[11px] text-muted-foreground tabular-nums">
                    {r.customerPhone}
                  </p>
                </td>
                <td className="py-3 px-4 text-muted-foreground">{r.cityName}</td>
                <td className="py-3 px-4 text-muted-foreground text-xs">
                  {r.execName ?? 'Unassigned'}
                </td>
                <td className="py-3 px-4 text-muted-foreground text-xs whitespace-nowrap">
                  {r.stageName}
                </td>
                <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                  {formatRupees(r.orderValuePaise)}
                </td>
                {variant !== 'pipeline' && (
                  <td className="py-3 px-4 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                    {formatRupees(r.receivedPaise)}
                  </td>
                )}
                {variant !== 'pipeline' && (
                  <td
                    className={cn(
                      'py-3 px-4 text-right tabular-nums font-medium whitespace-nowrap',
                      r.outstandingPaise > 0
                        ? 'text-amber-700 dark:text-amber-300'
                        : '',
                    )}
                  >
                    {formatRupees(r.outstandingPaise)}
                  </td>
                )}
                <td className="py-3 px-4 text-right text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                  {r.ageDays}d
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface PaymentDetailTableProps {
  rows: FinancePaymentRow[];
  requestHref?: (requestId: string) => string;
}

export function PaymentDetailTable({
  rows,
  requestHref,
}: PaymentDetailTableProps) {
  const hrefForRequest =
    requestHref ?? ((id: string) => `/requests/${id}`);

  if (rows.length === 0) {
    return (
      <div className="rounded-3xl border bg-muted/30 p-12 text-center">
        <p className="text-sm text-muted-foreground">
          No payments recorded yet.
        </p>
      </div>
    );
  }

  // Net + breakdown footer so the visible rows add up to the same
  // headline the tile shows.
  const inbound = rows
    .filter((r) => r.direction === 'inbound')
    .reduce((s, r) => s + Math.abs(r.amountPaise), 0);
  const outbound = rows
    .filter((r) => r.direction === 'outbound')
    .reduce((s, r) => s + Math.abs(r.amountPaise), 0);
  const net = inbound - outbound;

  return (
    <div className="space-y-3">
      <div className="rounded-3xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left py-2.5 px-4">Date</th>
                <th className="text-left py-2.5 px-4">Customer</th>
                <th className="text-right py-2.5 px-4">Amount</th>
                <th className="text-left py-2.5 px-4">Mode</th>
                <th className="text-left py-2.5 px-4">Recorded by</th>
                <th className="text-left py-2.5 px-4">Exec</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-muted/30">
                  <td className="py-3 px-4 text-muted-foreground tabular-nums whitespace-nowrap">
                    {formatPaymentDate(p.paymentDate)}
                  </td>
                  <td className="py-3 px-4">
                    <Link
                      href={hrefForRequest(p.requestId)}
                      className="text-primary hover:underline font-medium"
                    >
                      {p.customerName}
                    </Link>
                  </td>
                  <td
                    className={cn(
                      'py-3 px-4 text-right tabular-nums font-medium whitespace-nowrap',
                      p.direction === 'outbound'
                        ? 'text-rose-700 dark:text-rose-300'
                        : 'text-emerald-700 dark:text-emerald-300',
                    )}
                  >
                    {formatRupees(p.amountPaise)}
                  </td>
                  <td className="py-3 px-4 text-muted-foreground text-xs">
                    <span className="inline-flex items-center gap-1">
                      {p.direction === 'outbound' && (
                        <Icon name="undo" size="xs" />
                      )}
                      {p.mode}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-muted-foreground text-xs">
                    {p.recordedByName ?? '—'}
                  </td>
                  <td className="py-3 px-4 text-muted-foreground text-xs">
                    {p.execName ?? 'Unassigned'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reconcile footer — explains the tile total = inbound − outbound. */}
      <div className="rounded-2xl border bg-muted/30 px-4 py-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Inbound {formatRupees(inbound)} − Refunds {formatRupees(outbound)}
          </span>
          <span className="font-semibold tabular-nums">
            Net {formatRupees(net)}
          </span>
        </div>
      </div>
    </div>
  );
}
