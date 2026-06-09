import { desc, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { supportTickets, users, visitRequests } from '@/db/schema';

// =============================================================================
// HVA-254 (HVA-232 Phase 1): support tickets read-side
// =============================================================================
//
// Two consumers:
//   - /track/[token] customer page renders the tickets-for-this-order section
//   - Phase 2 (HVA-256) will add /tickets queue + per-ticket detail
//
// This file ships only the /track loader. The Phase 2 queue lives in a
// separate file when it lands so we don't load admin-shaped queries into
// the public route's RSC bundle.
// =============================================================================

export interface CustomerTicketRow {
  id: string;
  subject: string;
  category: 'complaint' | 'warranty' | 'refund' | 'other';
  status: 'open' | 'in_progress' | 'resolved';
  openedAt: Date;
  resolvedAt: Date | null;
  reopenedAt: Date | null;
  // Display the owner's first name in "Priya is handling this" once claimed.
  ownerFirstName: string | null;
}

export async function loadTicketsForRequest(
  requestId: string,
): Promise<CustomerTicketRow[]> {
  const rows = await db
    .select({
      id: supportTickets.id,
      subject: supportTickets.subject,
      category: supportTickets.category,
      status: supportTickets.status,
      openedAt: supportTickets.openedAt,
      resolvedAt: supportTickets.resolvedAt,
      reopenedAt: supportTickets.reopenedAt,
      claimedByName: users.fullName,
    })
    .from(supportTickets)
    .leftJoin(users, eq(users.id, supportTickets.claimedByUserId))
    .where(eq(supportTickets.requestId, requestId))
    .orderBy(desc(supportTickets.openedAt));

  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    category: r.category,
    status: r.status,
    openedAt: r.openedAt,
    resolvedAt: r.resolvedAt,
    reopenedAt: r.reopenedAt,
    ownerFirstName: r.claimedByName?.split(' ')[0] ?? null,
  }));
}

// Used by the public reopen endpoint to confirm the ticket belongs to the
// caller's tracking_token before flipping status.
export async function findTicketByTokenAndId(
  trackingToken: string,
  ticketId: string,
): Promise<{
  ticketId: string;
  requestId: string;
  status: 'open' | 'in_progress' | 'resolved';
  customerName: string;
} | null> {
  const [row] = await db
    .select({
      ticketId: supportTickets.id,
      requestId: supportTickets.requestId,
      status: supportTickets.status,
      customerName: visitRequests.customerName,
    })
    .from(supportTickets)
    .innerJoin(visitRequests, eq(visitRequests.id, supportTickets.requestId))
    .where(eq(supportTickets.id, ticketId))
    .limit(1);
  if (!row) return null;
  // Guard: the ticket must belong to the request identified by the token.
  const [reqRow] = await db
    .select({ id: visitRequests.id })
    .from(visitRequests)
    .where(eq(visitRequests.trackingToken, trackingToken))
    .limit(1);
  if (!reqRow || reqRow.id !== row.requestId) return null;
  return row;
}
