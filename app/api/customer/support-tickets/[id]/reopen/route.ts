import { headers as headersFn } from 'next/headers';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { db } from '@/db/client';
import { supportTickets, visitRequests } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { log } from '@/lib/logger';
import { dispatchNotification } from '@/lib/notifications/engine';
import { verifyTurnstile } from '@/lib/turnstile';

// =============================================================================
// HVA-254 (HVA-232 Phase 1): customer reopens a resolved ticket
// =============================================================================
//
// POST /api/customer/support-tickets/[id]/reopen
//
// Used when the customer says "not actually resolved" on /track. Flips
// status resolved → open + sets reopened_at + re-fires the team
// notification so exec/captain see it pop up again.
//
// Auth: caller must possess a valid tracking_token matching the order
// this ticket belongs to. Plus Turnstile so the reopen button can't be
// scripted.
//
// Idempotent on tickets already in `open` or `in_progress`: returns 200
// with status='already-open' and no DB write.
// =============================================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const routeLog = log.child({ component: 'customer.support-tickets.reopen' });

const bodySchema = z.object({
  trackingToken: z.string().min(8).max(32),
  turnstileToken: z.string().min(1),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: ticketId } = await params;

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
      { ok: false, error: 'Invalid input' },
      { status: 400 },
    );
  }

  const ip = (await headersFn()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  const turnstile = await verifyTurnstile(parsed.data.turnstileToken, ip);
  if (!turnstile.success) {
    return NextResponse.json(
      { ok: false, error: 'Verification failed. Please retry the challenge.' },
      { status: 400 },
    );
  }

  // Load + verify the ticket belongs to the token's request
  const [row] = await db
    .select({
      ticketId: supportTickets.id,
      requestId: supportTickets.requestId,
      status: supportTickets.status,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      assignedExecUserId: visitRequests.assignedExecUserId,
      assignedCaptainUserId: visitRequests.assignedCaptainUserId,
      cityId: visitRequests.cityId,
      trackingToken: visitRequests.trackingToken,
      subject: supportTickets.subject,
      category: supportTickets.category,
    })
    .from(supportTickets)
    .innerJoin(visitRequests, eq(visitRequests.id, supportTickets.requestId))
    .where(eq(supportTickets.id, ticketId))
    .limit(1);

  if (!row || row.trackingToken !== parsed.data.trackingToken) {
    return NextResponse.json(
      { ok: false, error: 'Ticket not found' },
      { status: 404 },
    );
  }

  if (row.status !== 'resolved') {
    return NextResponse.json(
      { ok: true, status: 'already-open' },
      { status: 200 },
    );
  }

  const now = new Date();
  await db
    .update(supportTickets)
    .set({
      status: 'open',
      reopenedAt: now,
      // Wipe the resolution fields so the queue shows it as "open" and
      // a future resolve writes a fresh resolved_at/_by.
      resolvedAt: null,
      resolvedByUserId: null,
      updatedAt: now,
    })
    .where(eq(supportTickets.id, ticketId));

  await logEvent({
    eventType: 'support_ticket_reopened',
    actorUserId: null,
    targetEntityType: 'support_ticket',
    targetEntityId: ticketId,
    beforeState: { status: 'resolved' },
    afterState: { status: 'open', reopenedAt: now.toISOString() },
  });

  // Re-fire the create notification — exec/captain see the ticket pop
  // back up in their feed.
  try {
    void dispatchNotification('customer.support_ticket_created', {
      ticketId,
      requestId: row.requestId,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      category: row.category,
      subject: row.subject,
      cityId: row.cityId,
      execUserId: row.assignedExecUserId,
      captainUserId: row.assignedCaptainUserId,
      reopened: true,
    });
  } catch (err) {
    routeLog.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'support_ticket_reopen_notify_failed',
    );
  }

  routeLog.info({ ticketId, requestId: row.requestId }, 'support_ticket_reopened');

  return NextResponse.json({ ok: true, status: 'open' }, { status: 200 });
}
