// =============================================================================
// HVA-254 (HVA-232 Phase 1): in-app composer for customer.support_ticket_created
// =============================================================================
//
// Fired when a customer raises a ticket via /track/[token]. Body is the
// ticket subject (truncated) + a label of the category so the exec can
// triage at a glance. linkUrl points to /requests/[id] today since the
// internal /tickets queue is HVA-256 (Phase 2) — when that lands, this
// can switch to /tickets/[ticketId].
// =============================================================================

export interface InAppBody {
  title: string;
  body: string;
  linkUrl: string;
}

export interface SupportTicketCreatedContext {
  ticketId: string;
  requestId: string;
  customerName: string;
  // HVA-257: open string — categories are admin-configurable
  // (support_ticket_categories table) since HVA-256-FIX1, so any code
  // can arrive here, not just the 4 seeded ones.
  category: string;
  subject: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  complaint: 'Complaint',
  warranty: 'Warranty claim',
  refund: 'Refund request',
  other: 'Question',
};

export function composeSupportTicketCreatedInApp(
  ctx: SupportTicketCreatedContext,
): InAppBody {
  // HVA-257: indexing the fixed map with an admin-created code used to
  // return undefined and throw on .toLowerCase(), silently killing the
  // notification. Fall back to the code itself, humanized.
  const label =
    CATEGORY_LABEL[ctx.category] ?? ctx.category.replace(/_/g, ' ');
  return {
    title: `New ${label.toLowerCase()} from ${ctx.customerName}`,
    body: ctx.subject.length > 120
      ? `${ctx.subject.slice(0, 117)}…`
      : ctx.subject,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}
