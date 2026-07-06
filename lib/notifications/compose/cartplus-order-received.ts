// =============================================================================
// Composer for `webhook.cartplus.order_received`
// =============================================================================
//
// In-app fan-out to the assigned exec, the owning city captain, and
// super_admins when a CartPlus portal order webhook lands and is merged
// onto a Beakn request. Pure: reads the resolved context, no I/O.
// =============================================================================

import type { InAppBody } from './request-assigned';

export interface CartplusOrderReceivedContext {
  requestId: string;
  customerName: string;
  orderNumber?: string | null;
  totalAmountInr?: number | string | null;
}

export function composeCartplusOrderReceivedInApp(
  ctx: CartplusOrderReceivedContext,
): InAppBody {
  const orderRef = ctx.orderNumber ? ` (#${ctx.orderNumber})` : '';
  return {
    title: `New CartPlus order: ${ctx.customerName}`,
    body: `A CartPlus portal order${orderRef} was received for ${ctx.customerName}.`,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}
