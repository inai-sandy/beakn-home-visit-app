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
  category: 'complaint' | 'warranty' | 'refund' | 'other';
  subject: string;
}

const CATEGORY_LABEL: Record<
  SupportTicketCreatedContext['category'],
  string
> = {
  complaint: 'Complaint',
  warranty: 'Warranty claim',
  refund: 'Refund request',
  other: 'Question',
};

export function composeSupportTicketCreatedInApp(
  ctx: SupportTicketCreatedContext,
): InAppBody {
  return {
    title: `New ${CATEGORY_LABEL[ctx.category].toLowerCase()} from ${ctx.customerName}`,
    body: ctx.subject.length > 120
      ? `${ctx.subject.slice(0, 117)}…`
      : ctx.subject,
    linkUrl: `/requests/${ctx.requestId}`,
  };
}
