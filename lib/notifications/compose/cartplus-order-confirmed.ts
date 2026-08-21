// =============================================================================
// HVA-345: composer for `webhook.cartplus.order_confirmed`
// =============================================================================
//
// In-app + push to the assigned exec and the owning city captain when CartPlus
// confirms an order. Internal only: CartPlus already messages the customer.
//
// Support is NOT a recipient here — they hear the same moment through
// `support.order_ready_for_dispatch` (HVA-341), whose wording is about the
// dispatch queue rather than the sale. Two messages to support for one event
// would be the duplicate HVA-326 went out of its way to avoid.
//
// Pure: reads the resolved context, no I/O.
// =============================================================================

import type { InAppBody } from './request-assigned';

export interface CartplusOrderConfirmedContext {
  requestId: string;
  customerName: string;
  orderNumber?: string | null;
  totalAmountInr?: number | string | null;
  recipientRole?: string;
}

/** CartPlus sends totals in RUPEES, not paise. */
function formatOrderTotal(value: number | string | null | undefined): string | null {
  if (value == null) return null;
  const rupees = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(rupees) || rupees <= 0) return null;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(rupees);
}

export function composeCartplusOrderConfirmedInApp(
  ctx: CartplusOrderConfirmedContext,
): InAppBody {
  const orderRef = ctx.orderNumber ? ` (${ctx.orderNumber})` : '';
  const total = formatOrderTotal(ctx.totalAmountInr);
  // The captain reads a city's worth of these, so the value is what makes one
  // worth opening. Omitted rather than shown as ₹0 when CartPlus sends nothing.
  const valueLine = total ? ` Order value ${total}.` : '';
  const isCaptain = (ctx.recipientRole ?? '').startsWith('captain');
  return {
    title: `Order confirmed: ${ctx.customerName}`,
    body: isCaptain
      ? `${ctx.customerName}'s order${orderRef} is confirmed in CartPlus.${valueLine} It is booked business for your city.`
      : `${ctx.customerName}'s order${orderRef} is confirmed in CartPlus.${valueLine} Support has it for dispatch.`,
    linkUrl: isCaptain
      ? `/captain/requests/${ctx.requestId}`
      : `/requests/${ctx.requestId}`,
  };
}
