import { formatInrFromPaise } from '@/lib/money';

import type { LineItemRow } from '@/app/requests/[id]/_actions/lineItems';

// =============================================================================
// HVA-286: Order tab on the public /track page
// =============================================================================
//
// Customer-facing, read-only. Shows the items on the order (from the
// CartPlus quotation) + the order value. Graceful empty state until a
// quotation exists. The per-line breakdown (delivery/discount) will slot
// in once CartPlus exposes those fields on the order payload.
// =============================================================================

interface Props {
  items: LineItemRow[];
  orderValuePaise: number | null;
}

export function OrderTab({ items, orderValuePaise }: Props) {
  if (orderValuePaise === null) {
    return (
      <section
        aria-label="Order details"
        className="rounded-3xl border bg-card p-6 text-center text-sm text-muted-foreground"
      >
        Your order details will appear here once your quotation is ready.
      </section>
    );
  }

  return (
    <section aria-label="Order details" className="space-y-4">
      <h3 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
        Your order
      </h3>

      {items.length > 0 ? (
        <ul className="divide-y rounded-2xl border bg-card">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-start justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">{it.productName}</p>
                <p className="text-xs text-muted-foreground">
                  {it.quantity} × {formatInrFromPaise(it.unitPricePaise)}
                </p>
              </div>
              <p className="text-sm font-medium tabular-nums shrink-0">
                {formatInrFromPaise(it.lineTotalPaise)}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Itemised list will appear here shortly.
        </p>
      )}

      <div className="flex items-baseline justify-between rounded-2xl border bg-muted/30 px-4 py-3">
        <span className="text-sm font-semibold">Order total</span>
        <span className="text-xl font-semibold tabular-nums">
          {formatInrFromPaise(orderValuePaise)}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Total includes any delivery and discounts applied to your order.
      </p>
    </section>
  );
}
