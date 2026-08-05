// =============================================================================
// HVA-325: composer for `webhook.cartplus.order_changed`
// =============================================================================
//
// Internal only. CartPlus has already messaged the customer about the edit
// they made; this exists so the exec, the captain and support are not the
// last to know that a confirmed order is no longer the order they confirmed.
//
// The message leads with the money, because that is what people check. The
// item counts follow, because "₹4,174 → ₹8,354" and "₹4,174 → ₹8,354, 2
// items → 3" are two different conversations with the customer.
// =============================================================================

import { formatInrFromPaise } from '@/lib/money';

import type { InAppBody } from './request-assigned';

export interface CartplusOrderChangedContext {
  requestId: string;
  customerName: string;
  orderNumber?: string | null;
  /** Human name of the stage the request was at when the edit landed. */
  stageName?: string | null;
  previousTotalPaise?: number | null;
  newTotalPaise?: number | null;
  previousItemCount?: number | null;
  newItemCount?: number | null;
  itemsAdded?: number | null;
  itemsRemoved?: number | null;
  itemsAmended?: number | null;
}

function num(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** "₹4,174 → ₹8,354", or null when the total did not move. */
function moneyPhrase(ctx: CartplusOrderChangedContext): string | null {
  const before = num(ctx.previousTotalPaise);
  const after = num(ctx.newTotalPaise);
  if (before === after) return null;
  return `${formatInrFromPaise(before)} → ${formatInrFromPaise(after)}`;
}

/**
 * What happened to the items, in words. Returns null when only the money
 * moved (a discount, say) so the message doesn't pad itself with "0 items".
 */
function itemsPhrase(ctx: CartplusOrderChangedContext): string | null {
  const parts: string[] = [];
  const added = num(ctx.itemsAdded);
  const removed = num(ctx.itemsRemoved);
  const amended = num(ctx.itemsAmended);
  if (added > 0) parts.push(`${added} added`);
  if (removed > 0) parts.push(`${removed} removed`);
  if (amended > 0) parts.push(`${amended} changed`);
  if (parts.length === 0) return null;

  const before = num(ctx.previousItemCount);
  const after = num(ctx.newItemCount);
  return `${parts.join(', ')} (${before} → ${after} items)`;
}

export function composeCartplusOrderChangedInApp(
  ctx: CartplusOrderChangedContext,
): InAppBody {
  const money = moneyPhrase(ctx);
  const items = itemsPhrase(ctx);
  const ref = ctx.orderNumber ? ` (#${ctx.orderNumber})` : '';
  const stage = ctx.stageName ? ` while at ${ctx.stageName}` : '';

  // Both, one, or — if a caller ever dispatches with an empty diff — a
  // truthful fallback rather than an empty sentence.
  const detail =
    money && items
      ? `${money}. ${items}.`
      : money
        ? `${money}.`
        : items
          ? `${items}.`
          : 'The order was edited in CartPlus.';

  const title = money
    ? `Order value changed: ${ctx.customerName}`
    : `Order changed: ${ctx.customerName}`;

  return {
    title,
    body: `The CartPlus order${ref} was edited${stage}. ${detail}`,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}
