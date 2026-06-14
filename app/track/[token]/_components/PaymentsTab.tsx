import { Icon } from '@/components/ui/icon';
import type { CollectionSummary } from '@/lib/collection-summary';
import { formatInrFromPaise } from '@/lib/money';
import { cn } from '@/lib/utils';

// =============================================================================
// HVA-286: Payments tab on the public /track page
// =============================================================================
//
// Customer-facing, read-only. Shows the order total, amount paid, balance
// due, and a customer-safe payment history (date · amount · mode). It
// deliberately omits internal fields — who recorded the payment, reference
// numbers, internal notes — since this link is public (token only, no
// login). A disabled "Pay online" placeholder appears when there's a
// balance, reserving the spot for the future Razorpay flow.
// =============================================================================

export interface CustomerPaymentRow {
  /** ISO date (payment_date). */
  date: string;
  amountPaise: number;
  /** Payment mode label (UPI / Cash / Bank Transfer …). */
  mode: string;
  direction: 'inbound' | 'outbound';
}

interface Props {
  summary: CollectionSummary;
  payments: CustomerPaymentRow[];
  /** True once a CartPlus quotation exists (so a balance is meaningful). */
  hasQuotation: boolean;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function PaymentsTab({ summary, payments, hasQuotation }: Props) {
  if (!hasQuotation && payments.length === 0) {
    return (
      <section
        aria-label="Payments"
        className="rounded-3xl border bg-card p-6 text-center text-sm text-muted-foreground"
      >
        Payment details will appear here once your order is ready.
      </section>
    );
  }

  return (
    <section aria-label="Payments" className="space-y-4">
      {/* Summary */}
      <div className="rounded-2xl border bg-card p-4 space-y-2">
        <Row label="Order total" value={formatInrFromPaise(summary.quotedPaise)} />
        <Row label="Paid" value={formatInrFromPaise(summary.netReceivedPaise)} />
        <div className="border-t pt-2">
          {summary.isOverpaid ? (
            <Row
              label="Overpaid"
              value={formatInrFromPaise(summary.overpaidPaise)}
              tone="amber"
              bold
            />
          ) : (
            <Row
              label="Balance due"
              value={formatInrFromPaise(summary.balancePaise)}
              tone={summary.isFullyCollected ? 'green' : 'red'}
              bold
            />
          )}
        </div>
      </div>

      {/* Pay online — reserved for Razorpay (HVA-286). Disabled until wired. */}
      {!summary.isFullyCollected && !summary.isOverpaid && summary.balancePaise > 0 && (
        <button
          type="button"
          disabled
          className="w-full rounded-2xl border bg-muted/40 px-4 py-3 text-sm font-medium text-muted-foreground inline-flex items-center justify-center gap-2 cursor-not-allowed"
        >
          <Icon name="lock" size="sm" />
          Pay online — coming soon
        </button>
      )}

      {/* History */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
          Payment history
        </h3>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card">
            {payments.map((p, i) => (
              <li
                key={`${p.date}-${i}`}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {p.direction === 'outbound' ? 'Refund' : 'Payment received'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(p.date)} · {p.mode}
                  </p>
                </div>
                <p
                  className={cn(
                    'text-sm font-medium tabular-nums shrink-0',
                    p.direction === 'outbound' ? 'text-amber-600' : '',
                  )}
                >
                  {p.direction === 'outbound' ? '−' : ''}
                  {formatInrFromPaise(p.amountPaise)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Row({
  label,
  value,
  tone,
  bold,
}: {
  label: string;
  value: string;
  tone?: 'green' | 'red' | 'amber';
  bold?: boolean;
}) {
  const toneCls =
    tone === 'green'
      ? 'text-emerald-700'
      : tone === 'red'
        ? 'text-destructive'
        : tone === 'amber'
          ? 'text-amber-700'
          : '';
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={cn('text-sm', toneCls)}>{label}</span>
      <span className={cn('text-sm tabular-nums', toneCls, bold && 'font-semibold')}>
        {value}
      </span>
    </div>
  );
}
