import { formatInrFromPaise } from '@/lib/money';

import type { LineItemRow } from '@/app/requests/[id]/_actions/lineItems';

// =============================================================================
// HVA-286: Order tab on the public /track page
// =============================================================================
//
// Customer-facing, read-only. Shows the items on the order (from the
// CartPlus quotation) + the money breakdown (subtotal − discount +
// delivery + tax = total). Graceful empty state until a quotation exists.
// HVA-296: breakdown now populated from CartPlus's data.order fields.
// =============================================================================

interface Props {
  items: LineItemRow[];
  orderValuePaise: number | null;
  breakdown?: {
    subtotalPaise: number | null;
    discountPaise: number | null;
    deliveryPaise: number | null;
    taxPaise: number | null;
  } | null;
}

export function OrderTab({ items, orderValuePaise, breakdown }: Props) {
  const hasBreakdown =
    !!breakdown &&
    (breakdown.subtotalPaise != null ||
      !!breakdown.discountPaise ||
      !!breakdown.deliveryPaise ||
      !!breakdown.taxPaise);
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

      <div className="space-y-2 rounded-2xl border bg-muted/30 px-4 py-3">
        {hasBreakdown && breakdown && (
          <dl className="space-y-1 text-sm">
            {breakdown.subtotalPaise != null && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Items subtotal</dt>
                <dd className="tabular-nums">
                  {formatInrFromPaise(Number(breakdown.subtotalPaise))}
                </dd>
              </div>
            )}
            {breakdown.discountPaise ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Discount</dt>
                <dd className="tabular-nums text-emerald-700 dark:text-emerald-300">
                  − {formatInrFromPaise(Number(breakdown.discountPaise))}
                </dd>
              </div>
            ) : null}
            {breakdown.deliveryPaise ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Delivery</dt>
                <dd className="tabular-nums">
                  + {formatInrFromPaise(Number(breakdown.deliveryPaise))}
                </dd>
              </div>
            ) : null}
            {breakdown.taxPaise ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Tax</dt>
                <dd className="tabular-nums">
                  + {formatInrFromPaise(Number(breakdown.taxPaise))}
                </dd>
              </div>
            ) : null}
          </dl>
        )}
        <div
          className={
            'flex items-baseline justify-between' +
            (hasBreakdown ? ' border-t pt-2' : '')
          }
        >
          <span className="text-sm font-semibold">Order total</span>
          <span className="text-xl font-semibold tabular-nums">
            {formatInrFromPaise(orderValuePaise)}
          </span>
        </div>
      </div>
      {!hasBreakdown && (
        <p className="text-[11px] text-muted-foreground">
          Total includes any delivery and discounts applied to your order.
        </p>
      )}
    </section>
  );
}
