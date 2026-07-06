import { headers as headersFn } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import {
  cities,
  supportTicketMessages,
  supportTickets,
  visitRequests,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { log } from '@/lib/logger';
import { dispatchNotification } from '@/lib/notifications/engine';
import { verifyTurnstile } from '@/lib/turnstile';

// =============================================================================
// HVA-232 Phase 3 (migration 0082): customer replies on a support ticket
// =============================================================================
//
// POST /api/customer/support-tickets/[id]/reply
//
// The customer side of the two-way thread. Anyone holding the order's
// tracking_token (+ passing Turnstile) can append a message to a ticket
// that is still open or in_progress. Resolved tickets can't be replied to
// — the customer reopens first (existing /reopen route).
//
// On success: inserts a customer message (author_kind='customer',
// author_user_id NULL), audits, and fires the staff-facing
// customer.support_ticket_reply notification (exec + city captain).
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const routeLog = log.child({ component: 'customer.support-tickets.reply' });

const bodySchema = z.object({
  trackingToken: z.string().min(8).max(32),
  body: z.string().trim().min(1).max(2000),
  turnstileToken: z.string().min(1),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: ticketId } = await params;

  if (!z.string().uuid().safeParse(ticketId).success) {
    return NextResponse.json(
      { ok: false, error: 'Invalid ticket id' },
      { status: 400 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON' },
      { status: 400 },
    );
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const ip =
    (await headersFn()).get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';

  const turnstile = await verifyTurnstile(parsed.data.turnstileToken, ip);
  if (!turnstile.success) {
    return NextResponse.json(
      { ok: false, error: 'Verification failed. Please retry the challenge.' },
      { status: 400 },
    );
  }

  // Load + verify the ticket belongs to the token's request.
  const [row] = await db
    .select({
      ticketId: supportTickets.id,
      requestId: supportTickets.requestId,
      status: supportTickets.status,
      subject: supportTickets.subject,
      customerName: visitRequests.customerName,
      assignedExecUserId: visitRequests.assignedExecUserId,
      cityCaptainUserId: cities.captainUserId,
      trackingToken: visitRequests.trackingToken,
    })
    .from(supportTickets)
    .innerJoin(visitRequests, eq(visitRequests.id, supportTickets.requestId))
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .where(eq(supportTickets.id, ticketId))
    .limit(1);

  if (!row || row.trackingToken !== parsed.data.trackingToken) {
    return NextResponse.json(
      { ok: false, error: 'Ticket not found' },
      { status: 404 },
    );
  }

  // Only open / in_progress tickets accept a reply. A resolved ticket must
  // be reopened first (keeps the resolved state honest + audit-clean).
  if (row.status === 'resolved') {
    return NextResponse.json(
      {
        ok: false,
        error: 'This ticket is resolved. Reopen it first to add a reply.',
      },
      { status: 409 },
    );
  }

  let messageId: string;
  try {
    const [inserted] = await db
      .insert(supportTicketMessages)
      .values({
        ticketId,
        authorKind: 'customer',
        authorUserId: null,
        body: parsed.data.body,
      })
      // Belt-and-braces: the ticket must still be non-resolved. The CHECK +
      // FK protect integrity; the status guard above is the product rule.
      .returning({ id: supportTicketMessages.id });
    messageId = inserted.id;
  } catch (err) {
    routeLog.error(
      { err: err instanceof Error ? err.message : String(err), ticketId },
      'support_ticket_reply_insert_failed',
    );
    return NextResponse.json(
      { ok: false, error: 'Could not send — please try again' },
      { status: 500 },
    );
  }

  await logEvent({
    eventType: 'support_ticket_message_added',
    actorUserId: null,
    targetEntityType: 'support_ticket',
    targetEntityId: ticketId,
    afterState: { authorKind: 'customer', context: 'reply' },
  });

  // Notify staff (exec + city captain) — in-app + push. Fire-and-forget.
  try {
    void dispatchNotification('customer.support_ticket_reply', {
      ticketId,
      requestId: row.requestId,
      customerName: row.customerName,
      subject: row.subject,
      bodyPreview:
        parsed.data.body.length > 80
          ? `${parsed.data.body.slice(0, 77)}…`
          : parsed.data.body,
      execUserId: row.assignedExecUserId,
      cityCaptainUserId: row.cityCaptainUserId,
    });
  } catch (err) {
    routeLog.warn(
      { err: err instanceof Error ? err.message : String(err), ticketId },
      'support_ticket_reply_notify_failed',
    );
  }

  routeLog.info({ ticketId, messageId }, 'support_ticket_reply');
  void and;

  return NextResponse.json({ ok: true, messageId }, { status: 200 });
}
