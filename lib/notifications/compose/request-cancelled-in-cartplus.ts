// =============================================================================
// HVA-326: composer for `request.cancelled_in_cartplus`
// =============================================================================
//
// Internal-only. CartPlus has already told the customer, so nothing here is
// customer-facing — this exists so the exec, the captain and support hear
// about a cancellation that until now happened in silence.
//
// Two things make this message useful rather than noise:
//
//   1. the STAGE the request had reached. "Cancelled" reads very differently
//      at Quotation Given than at Installation Scheduled, where a captain
//      has already blocked out a day.
//   2. whether anything has already been DISPATCHED. Sandeep handles the
//      physical recovery by hand, so the notification's job is to tell him
//      that a recovery is needed at all.
//
// The engine injects `recipientRole` into the context for events with
// several recipient_role rules (HVA-140), so one composer serves all four
// audiences and support gets the version written for what support does.
// =============================================================================

// HVA-329: shared with the customer-cancel path so the wording cannot drift.
import { dispatchWarning, stagePhrase } from './cancellation-phrases';

import type { InAppBody } from './request-assigned';

export interface RequestCancelledInCartplusContext {
  requestId: string;
  customerName: string;
  cityName?: string | null;
  /** Human name of the stage the request was at when CartPlus cancelled it. */
  stageName?: string | null;
  orderNumber?: string | null;
  /** Quantity already dispatched across the order's line items. 0 = nothing shipped. */
  dispatchedItemCount?: number | null;
  /** Injected by the engine per rule — see HVA-140. */
  recipientRole?: string | null;
}

function orderRef(orderNumber: string | null | undefined): string {
  return orderNumber ? ` (#${orderNumber})` : '';
}

export function composeRequestCancelledInCartplusInApp(
  ctx: RequestCancelledInCartplusContext,
): InAppBody {
  const stage = stagePhrase(ctx.stageName);
  const ref = orderRef(ctx.orderNumber);
  const warning = dispatchWarning(ctx.dispatchedItemCount);
  const city = ctx.cityName ? ` (${ctx.cityName})` : '';

  // Support hold the dispatch queue — lead with the thing they act on.
  if (ctx.recipientRole === 'support_team_all') {
    return {
      title: `Order cancelled in CartPlus: ${ctx.customerName}${city}`,
      body: `The CartPlus order${ref} was cancelled${stage}. Stop any pending dispatch.${warning}`,
      linkUrl: `/requests/${ctx.requestId}`,
    };
  }

  return {
    title: `${ctx.customerName} — order cancelled in CartPlus`,
    body: `The CartPlus order${ref} was cancelled${stage}. Any scheduled visit or installation has been cleared.${warning}`,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}
