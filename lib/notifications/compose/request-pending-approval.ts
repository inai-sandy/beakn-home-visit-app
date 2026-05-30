// 2026-05-30: composers for `request.pending_approval` — exec finished
// installation/configuration and the request moved into
// PENDING_CAPTAIN_APPROVAL. Captain must approve before the request
// terminally completes.

export interface RequestPendingApprovalContext {
  requestId: string;
  customerName: string;
  cityName?: string | null;
  execName?: string | null;
}

export interface InAppBody {
  title: string;
  body: string;
  linkUrl: string;
}

export function composeRequestPendingApprovalForCaptain(
  ctx: RequestPendingApprovalContext,
): InAppBody {
  const city = ctx.cityName ? ` in ${ctx.cityName}` : '';
  const exec = ctx.execName ? ` (${ctx.execName})` : '';
  return {
    title: `Approval needed: ${ctx.customerName}`,
    body: `Exec marked work complete${exec}${city}. Approve to close the order.`,
    linkUrl: `/captain/approvals`,
  };
}

export function composeRequestPendingApprovalForAdmin(
  ctx: RequestPendingApprovalContext,
): InAppBody {
  const city = ctx.cityName ? ` (${ctx.cityName})` : '';
  const exec = ctx.execName ? ` — ${ctx.execName}` : '';
  return {
    title: `Pending approval: ${ctx.customerName}${city}`,
    body: `Awaiting captain approval${exec}.`,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}
