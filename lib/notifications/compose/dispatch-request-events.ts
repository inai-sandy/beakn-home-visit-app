// HVA-342: composers for the exec dispatch-request domain.
//
// Replaces assist-events.ts. The framing changed with the workflow: the old
// bodies told a captain that an exec had asked for something, and told the
// exec that a status had moved. These tell support what to ship and tell the
// exec what actually happened to the units they were waiting on.
//
// Every body names the customer rather than a request id, because the person
// reading it on a phone is about to either pack a box or ring that customer.

export interface DispatchRequestCreatedContext {
  dispatchRequestId: string;
  execName?: string | null;
  orderCount: number;
  itemCount: number;
  totalQty: number;
  priority: 'high' | 'medium' | 'low';
  requiredByDate?: string | null;
}

export interface DispatchRequestDecisionContext {
  dispatchRequestId: string;
  customerName: string;
  itemSummary: string;
  reason?: string | null;
}

export interface DispatchRequestItemCancelledContext {
  dispatchRequestId: string;
  customerName: string;
  productName: string;
  quantity: number;
}

export interface InAppBody {
  title: string;
  body: string;
  linkUrl: string;
}

function execRequestLink(id: string): string {
  return `/dispatch/requests/${id}`;
}

function supportInboxLink(): string {
  return '/support/requests';
}

function unitsPhrase(qty: number): string {
  return qty === 1 ? '1 unit' : `${qty} units`;
}

function ordersPhrase(count: number): string {
  return count === 1 ? '1 order' : `${count} orders`;
}

function reasonSuffix(reason: string | null | undefined): string {
  const trimmed = reason?.trim() ?? '';
  return trimmed.length > 0 ? ` Reason: ${trimmed}.` : '';
}

function urgencySuffix(
  priority: 'high' | 'medium' | 'low',
  requiredByDate: string | null | undefined,
): string {
  const parts: string[] = [];
  // Only 'high' is called out. Labelling the default as "medium priority" in
  // every notification trains people to ignore the word entirely.
  if (priority === 'high') parts.push('Marked urgent');
  if (requiredByDate) parts.push(`needed by ${requiredByDate}`);
  return parts.length > 0 ? ` ${parts.join(', ')}.` : '';
}

// ---------------------------------------------------------------------------
// dispatch_request.created — support + admin
// ---------------------------------------------------------------------------

export function composeDispatchRequestCreatedForSupport(
  ctx: DispatchRequestCreatedContext,
): InAppBody {
  const who = ctx.execName?.trim() || 'A sales executive';
  return {
    title: `Dispatch requested — ${who}`,
    body:
      `${who} asked for ${unitsPhrase(ctx.totalQty)} across ` +
      `${ordersPhrase(ctx.orderCount)}.` +
      urgencySuffix(ctx.priority, ctx.requiredByDate),
    linkUrl: supportInboxLink(),
  };
}

export function composeDispatchRequestCreatedForAdmin(
  ctx: DispatchRequestCreatedContext,
): InAppBody {
  const who = ctx.execName?.trim() || 'A sales executive';
  return {
    title: `Dispatch requested — ${who}`,
    body:
      `${unitsPhrase(ctx.totalQty)} across ${ordersPhrase(ctx.orderCount)} ` +
      `awaiting support.` +
      urgencySuffix(ctx.priority, ctx.requiredByDate),
    linkUrl: supportInboxLink(),
  };
}

// ---------------------------------------------------------------------------
// Decisions — always to the exec who asked
// ---------------------------------------------------------------------------

export function composeDispatchRequestApprovedForExec(
  ctx: DispatchRequestDecisionContext,
): InAppBody {
  return {
    title: `Dispatched — ${ctx.customerName}`,
    body: `Support dispatched ${ctx.itemSummary}.`,
    linkUrl: execRequestLink(ctx.dispatchRequestId),
  };
}

export function composeDispatchRequestHeldForExec(
  ctx: DispatchRequestDecisionContext,
): InAppBody {
  return {
    title: `On hold — ${ctx.customerName}`,
    // "On hold" rather than "still pending": the exec needs to know somebody
    // has looked at this and it is not moving yet, so they can set the
    // customer's expectation instead of waiting quietly.
    body: `Support cannot dispatch ${ctx.itemSummary} yet.${reasonSuffix(ctx.reason)}`,
    linkUrl: execRequestLink(ctx.dispatchRequestId),
  };
}

export function composeDispatchRequestRejectedForExec(
  ctx: DispatchRequestDecisionContext,
): InAppBody {
  return {
    title: `Declined — ${ctx.customerName}`,
    body: `Support will not dispatch ${ctx.itemSummary}.${reasonSuffix(ctx.reason)}`,
    linkUrl: execRequestLink(ctx.dispatchRequestId),
  };
}

// ---------------------------------------------------------------------------
// dispatch_request.item_cancelled — the customer deleted it in CartPlus
// ---------------------------------------------------------------------------

export function composeDispatchRequestItemCancelledForExec(
  ctx: DispatchRequestItemCancelledContext,
): InAppBody {
  return {
    title: `Removed from order — ${ctx.customerName}`,
    body:
      `${ctx.customerName} deleted ${ctx.productName} in CartPlus, so your ` +
      `request for ${unitsPhrase(ctx.quantity)} of it has been cancelled.`,
    linkUrl: execRequestLink(ctx.dispatchRequestId),
  };
}
