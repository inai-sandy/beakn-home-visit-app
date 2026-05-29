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
