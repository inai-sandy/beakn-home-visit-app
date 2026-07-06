// =============================================================================
// Composer for `request.approval_overdue`
// =============================================================================
//
// In-app fan-out to the owning city captain when a request has sat in
// PENDING_CAPTAIN_APPROVAL past the escalation threshold (fired by the
// stale-approvals cron). Pure: reads the resolved context, no I/O.
// =============================================================================

import type { InAppBody } from './request-assigned';

export interface ApprovalOverdueContext {
  requestId: string;
  customerName: string;
  cityName?: string | null;
  hoursStuck?: number;
}

export function composeApprovalOverdueInApp(
  ctx: ApprovalOverdueContext,
): InAppBody {
  const stuck =
    typeof ctx.hoursStuck === 'number' && ctx.hoursStuck > 0
      ? ` — waiting ${ctx.hoursStuck}h for approval`
      : '';
  const where = ctx.cityName ? ` in ${ctx.cityName}` : '';
  return {
    title: `Approval overdue: ${ctx.customerName}`,
    body: `${ctx.customerName}'s request${where} is still awaiting your approval${stuck}.`,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}
