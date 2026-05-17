// =============================================================================
// HVA-137: composers for `request.approved` and `request.rejected`
// =============================================================================
//
// Both target the assigned exec via in-app drawer. No customer-facing
// notification this ship; the customer sees the change on /track via the
// timeline naturally. No captain self-notification — the captain just
// took the action.
// =============================================================================

import type { InAppBody } from './request-assigned';

export interface RequestApprovedContext {
  requestId: string;
  customerName: string;
  cityName: string;
  captainUserId: string;
  captainName: string;
  execUserId: string;
  execName: string;
  /** Optional captain note (≤ 500 chars). May be null/empty. */
  note?: string | null;
}

export interface RequestRejectedContext {
  requestId: string;
  customerName: string;
  cityName: string;
  captainUserId: string;
  captainName: string;
  execUserId: string;
  execName: string;
  /** Mandatory captain reason (50–500 chars). */
  reason: string;
}

export function composeRequestApprovedInApp(
  ctx: RequestApprovedContext,
): InAppBody {
  const trimmedNote =
    typeof ctx.note === 'string' ? ctx.note.trim() : '';
  const noteSuffix =
    trimmedNote.length > 0 ? ` Note: ${trimmedNote}` : '';
  return {
    title: `${ctx.captainName} approved ${ctx.customerName}'s order`,
    body: `Order marked complete in ${ctx.cityName}. Great work.${noteSuffix}`,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}

export function composeRequestRejectedInApp(
  ctx: RequestRejectedContext,
): InAppBody {
  return {
    title: `${ctx.captainName} requested changes on ${ctx.customerName}'s order`,
    body: `Back to Installation Scheduled in ${ctx.cityName}. Reason: ${ctx.reason}`,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}
