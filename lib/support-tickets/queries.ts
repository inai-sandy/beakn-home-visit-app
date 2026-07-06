import { asc, desc, eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  supportTicketMessages,
  supportTickets,
  users,
  visitRequests,
} from '@/db/schema';

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
  // HVA-232 Phase 3: the customer's opening message. Rendered as the first
  // bubble in the thread on /track so the conversation reads top-to-bottom.
  description: string;
  // HVA-256-FIX1: was a fixed enum; now a code string from
  // support_ticket_categories. The UI renders by joining the active
  // categories list passed alongside.
  category: string;
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
      description: supportTickets.description,
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
    description: r.description,
    category: r.category,
    status: r.status,
    openedAt: r.openedAt,
    resolvedAt: r.resolvedAt,
    reopenedAt: r.reopenedAt,
    ownerFirstName: r.claimedByName?.split(' ')[0] ?? null,
  }));
}

// =============================================================================
// HVA-232 Phase 3 (migration 0082): message thread read-side
// =============================================================================

export interface TicketMessageRow {
  id: string;
  authorKind: 'staff' | 'customer';
  authorUserId: string | null;
  // First name of the staff author ("Priya replied"); null for customer
  // messages (rendered as "You" on /track, "Customer" on the staff queue).
  authorFirstName: string | null;
  body: string;
  createdAt: Date;
}

/**
 * All messages for a single ticket, oldest first. Used by the staff queue's
 * expandable thread (via a scoped server action) and — indirectly — by the
 * per-request customer loader below.
 */
export async function loadTicketMessages(
  ticketId: string,
): Promise<TicketMessageRow[]> {
  const rows = await db
    .select({
      id: supportTicketMessages.id,
      authorKind: supportTicketMessages.authorKind,
      authorUserId: supportTicketMessages.authorUserId,
      authorName: users.fullName,
      body: supportTicketMessages.body,
      createdAt: supportTicketMessages.createdAt,
    })
    .from(supportTicketMessages)
    .leftJoin(users, eq(users.id, supportTicketMessages.authorUserId))
    .where(eq(supportTicketMessages.ticketId, ticketId))
    .orderBy(asc(supportTicketMessages.createdAt));

  return rows.map((r) => ({
    id: r.id,
    authorKind: r.authorKind,
    authorUserId: r.authorUserId,
    authorFirstName: r.authorName?.split(' ')[0] ?? null,
    body: r.body,
    createdAt: r.createdAt,
  }));
}

/**
 * Messages for every ticket on a request, grouped by ticketId. Loaded once
 * on the /track page so the customer sees each ticket's full thread without
 * a per-ticket round trip. Customer authors are anonymised (no user join
 * needed) — the UI shows staff first names and "You" for the customer.
 */
export async function loadTicketMessagesForRequest(
  requestId: string,
): Promise<Record<string, TicketMessageRow[]>> {
  const ticketRows = await db
    .select({ id: supportTickets.id })
    .from(supportTickets)
    .where(eq(supportTickets.requestId, requestId));
  const ticketIds = ticketRows.map((t) => t.id);
  if (ticketIds.length === 0) return {};

  const rows = await db
    .select({
      id: supportTicketMessages.id,
      ticketId: supportTicketMessages.ticketId,
      authorKind: supportTicketMessages.authorKind,
      authorUserId: supportTicketMessages.authorUserId,
      authorName: users.fullName,
      body: supportTicketMessages.body,
      createdAt: supportTicketMessages.createdAt,
    })
    .from(supportTicketMessages)
    .leftJoin(users, eq(users.id, supportTicketMessages.authorUserId))
    .where(inArray(supportTicketMessages.ticketId, ticketIds))
    .orderBy(asc(supportTicketMessages.createdAt));

  const byTicket: Record<string, TicketMessageRow[]> = {};
  for (const r of rows) {
    (byTicket[r.ticketId] ??= []).push({
      id: r.id,
      authorKind: r.authorKind,
      authorUserId: r.authorUserId,
      authorFirstName: r.authorName?.split(' ')[0] ?? null,
      body: r.body,
      createdAt: r.createdAt,
    });
  }
  return byTicket;
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
