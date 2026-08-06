import { dispatchWarning, stagePhrase } from './cancellation-phrases';

// Composers for `request.cancelled_by_customer`.
//
// Captain + admin variants — the customer-side cancellation is a signal both
// audiences care about. Exec-side composer isn't needed yet (exec sees the
// status change directly in their request detail); add one here if a rule
// gets seeded for exec_assigned later.

export interface RequestCancelledByCustomerContext {
  requestId: string;
  customerName: string;
  cityName?: string | null;
  reasonCode?: string | null;
  reasonNote?: string | null;
  /** HVA-329: support-only inputs. The stage the request died at, and how
   *  much stock is already out — the two things that decide whether anyone
   *  has to physically chase something. Optional so the captain/admin/exec
   *  composers are unaffected when a caller does not supply them. */
  stageName?: string | null;
  dispatchedItemCount?: number | null;
}

export interface InAppBody {
  title: string;
  body: string;
  linkUrl: string;
}

function reasonSuffix(
  reasonCode: string | null | undefined,
  reasonNote: string | null | undefined,
): string {
  // Reason codes are admin-configured short strings (e.g. 'changed_mind',
  // 'scheduling_conflict'). Display as a humanised phrase; fall back to
  // the free-text note if present.
  if (reasonCode) {
    const humanised = reasonCode.replace(/_/g, ' ');
    return ` Reason: ${humanised}.`;
  }
  if (reasonNote && reasonNote.trim().length > 0) {
    return ` Reason: ${reasonNote.trim()}.`;
  }
  return '';
}

export function composeRequestCancelledByCustomerForCaptain(
  ctx: RequestCancelledByCustomerContext,
): InAppBody {
  const reason = reasonSuffix(ctx.reasonCode, ctx.reasonNote);
  const city = ctx.cityName ? ` in ${ctx.cityName}` : '';
  return {
    title: `${ctx.customerName} cancelled their request`,
    body: `Customer cancelled their visit${city}.${reason}`,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}

export function composeRequestCancelledByCustomerForAdmin(
  ctx: RequestCancelledByCustomerContext,
): InAppBody {
  const reason = reasonSuffix(ctx.reasonCode, ctx.reasonNote);
  const city = ctx.cityName ? ` (${ctx.cityName})` : '';
  return {
    title: `Cancellation: ${ctx.customerName}${city}`,
    body: `Customer-initiated cancellation.${reason}`,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}

/**
 * HVA-329: support hold the dispatch queue, so they get the version written
 * for what support does — lead with "stop dispatching", then the recovery
 * warning if stock is already out. Same shape as the CartPlus support
 * variant, sharing its phrasing rather than copying it.
 *
 * Until this shipped, `support_team_all` had no rule on this event at all —
 * a customer cancelling from /track reached the exec, the captain and both
 * super_admins, and never the team holding the goods. HVA-326 fixed exactly
 * this for the CartPlus door and left the customer-facing one open.
 */
export function composeRequestCancelledByCustomerForSupport(
  ctx: RequestCancelledByCustomerContext,
): InAppBody {
  const reason = reasonSuffix(ctx.reasonCode, ctx.reasonNote);
  const stage = stagePhrase(ctx.stageName);
  const warning = dispatchWarning(ctx.dispatchedItemCount);
  const city = ctx.cityName ? ` (${ctx.cityName})` : '';
  return {
    title: `Cancelled by customer: ${ctx.customerName}${city}`,
    body: `The customer cancelled${stage}. Stop any pending dispatch.${warning}${reason}`,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}

export function composeRequestCancelledByCustomerForExec(
  ctx: RequestCancelledByCustomerContext,
): InAppBody {
  const reason = reasonSuffix(ctx.reasonCode, ctx.reasonNote);
  return {
    title: `${ctx.customerName} cancelled their visit`,
    body: `Customer cancelled the request you were handling.${reason}`,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}
