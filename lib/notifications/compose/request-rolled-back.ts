// =============================================================================
// HVA-141: composer for `request.rolled_back`
// =============================================================================
//
// Single channel this ship: in-app drawer for the captain who owns the
// request's city. Email/WhatsApp/Discord are deferred (HVA-50 expands
// the recipient matrix once notification surfaces stabilise).
//
// Composer is pure: no DB access. The engine passes the resolved context
// map; this function reads fields. Reason is optional and degrades to a
// "no reason given" suffix when null/empty.
// =============================================================================

import type { InAppBody } from './request-assigned';

export interface RequestRolledBackContext {
  requestId: string;
  customerName: string;
  /** User id of the captain owning the city — engine resolves this to the
   * in-app target via `captain_owning_city`. Compose function doesn't
   * use it directly; included here for the type contract. */
  cityCaptainUserId: string;
  /** Person who triggered the rollback (assigned exec, captain, or admin). */
  actorUserId: string;
  actorName: string;
  fromStageId: string;
  fromStageName: string;
  toStageId: string;
  toStageName: string;
  /** Optional free-text reason captured in the modal. May be null/empty. */
  reason?: string | null;
}

export function composeRequestRolledBackInApp(
  ctx: RequestRolledBackContext,
): InAppBody {
  const trimmedReason =
    typeof ctx.reason === 'string' ? ctx.reason.trim() : '';
  const reasonLine =
    trimmedReason.length > 0
      ? `Reason: ${trimmedReason}`
      : '(no reason given)';
  return {
    title: `${ctx.actorName} moved ${ctx.customerName} back`,
    body: `Status changed from ${ctx.fromStageName} to ${ctx.toStageName}. ${reasonLine}`,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}
