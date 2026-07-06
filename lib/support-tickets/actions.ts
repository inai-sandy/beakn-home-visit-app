'use server';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db/client';
import {
  cities,
  supportTicketMessages,
  supportTickets,
  visitRequests,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import { log } from '@/lib/logger';
import { dispatchNotification } from '@/lib/notifications/engine';
import {
  loadTicketMessages,
  type TicketMessageRow,
} from '@/lib/support-tickets/queries';

// =============================================================================
// HVA-255 (HVA-232 Phase 2): claim + resolve server actions
// HVA-257: ownership scope check + race-safe conditional updates
// =============================================================================
//
// Auth is 2-part per the project's 3-layer rule:
//   1. requireAgent(): session + role gate.
//   2. loadScopedTicket(): the caller must be able to SEE the ticket —
//      exec: assigned to the request; captain: request in team scope
//      (assigned captain OR assigned exec reports to them); super_admin:
//      everything. Server actions are directly invocable from any client
//      with a session, so read-side queue scoping is NOT a security
//      boundary — this check is.
//
// Race safety: status transitions use a conditional UPDATE
// (`WHERE id = X AND status = '<expected>'`) + RETURNING. If another
// agent won the race between our read and our write, 0 rows come back
// and we return ok:false instead of silently overwriting their claim.
// =============================================================================

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function requireAgent(): Promise<
  | { ok: true; userId: string; role: 'sales_executive' | 'captain' | 'super_admin' }
  | { ok: false; error: string }
> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const user = session.user as { id: string; role?: string };
  if (
    user.role !== USER_ROLES.SALES_EXECUTIVE &&
    user.role !== USER_ROLES.CAPTAIN &&
    user.role !== USER_ROLES.SUPER_ADMIN
  ) {
    return { ok: false, error: 'Forbidden' };
  }
  return {
    ok: true,
    userId: user.id,
    role: user.role as 'sales_executive' | 'captain' | 'super_admin',
  };
}

const idSchema = z.object({ ticketId: z.string().uuid() });

interface ScopedTicket {
  id: string;
  status: 'open' | 'in_progress' | 'resolved';
  requestId: string;
  subject: string;
  // Customer-notify context (resolve dispatch). Snapshotted phone/name are
  // taken from the request row so the WhatsApp composer + opt-in gate work.
  customerName: string;
  customerPhone: string;
  trackingToken: string;
  whatsappOptIn: boolean;
  cityCaptainUserId: string | null;
  execUserId: string | null;
}

/**
 * Load the ticket ONLY if the caller's role-scope can see it. Returns
 * null both for "doesn't exist" and "exists but out of scope" — callers
 * report a uniform 'Ticket not found' so the action doesn't leak ticket
 * existence to out-of-scope users.
 */
async function loadScopedTicket(
  ticketId: string,
  auth: { userId: string; role: 'sales_executive' | 'captain' | 'super_admin' },
): Promise<ScopedTicket | null> {
  const scopeConditions = [eq(supportTickets.id, ticketId)];

  if (auth.role === 'sales_executive') {
    scopeConditions.push(eq(visitRequests.assignedExecUserId, auth.userId));
  } else if (auth.role === 'captain') {
    // Team scope — same rule as lib/support-tickets/queue-queries.ts:
    // assigned captain on the request, OR the assigned exec reports to
    // this captain via sales_executives.captain_user_id.
    scopeConditions.push(
      sql`(${visitRequests.assignedCaptainUserId} = ${auth.userId}
        OR ${visitRequests.assignedExecUserId} IN (
          SELECT user_id FROM sales_executives
          WHERE captain_user_id = ${auth.userId}
        ))`,
    );
  }
  // super_admin: no extra condition.

  const [row] = await db
    .select({
      id: supportTickets.id,
      status: supportTickets.status,
      requestId: supportTickets.requestId,
      subject: supportTickets.subject,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      trackingToken: visitRequests.trackingToken,
      whatsappOptIn: visitRequests.whatsappOptIn,
      cityCaptainUserId: cities.captainUserId,
      execUserId: visitRequests.assignedExecUserId,
    })
    .from(supportTickets)
    .innerJoin(visitRequests, eq(visitRequests.id, supportTickets.requestId))
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .where(and(...scopeConditions))
    .limit(1);

  return row ?? null;
}

// -----------------------------------------------------------------------------
// claim — open → in_progress
// -----------------------------------------------------------------------------

export async function claimTicketAction(
  input: z.infer<typeof idSchema>,
): Promise<ActionResult> {
  const auth = await requireAgent();
  if (!auth.ok) return auth;

  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input' };

  const before = await loadScopedTicket(parsed.data.ticketId, auth);
  if (!before) return { ok: false, error: 'Ticket not found' };
  if (before.status !== 'open') {
    return {
      ok: false,
      error: `Ticket is already ${before.status === 'in_progress' ? 'in progress' : before.status}`,
    };
  }

  const now = new Date();
  // Conditional update: only flips if the ticket is STILL open. A
  // concurrent claim that landed between our read and this write makes
  // this match 0 rows — we then report the loss instead of overwriting.
  const updated = await db
    .update(supportTickets)
    .set({
      status: 'in_progress',
      claimedAt: now,
      claimedByUserId: auth.userId,
      updatedAt: now,
    })
    .where(
      and(
        eq(supportTickets.id, parsed.data.ticketId),
        eq(supportTickets.status, 'open'),
      ),
    )
    .returning({ id: supportTickets.id });

  if (updated.length === 0) {
    return {
      ok: false,
      error: 'Someone else just claimed this ticket — refresh to see the owner',
    };
  }

  await logEvent({
    eventType: 'support_ticket_claimed',
    actorUserId: auth.userId,
    actorRole: auth.role,
    targetEntityType: 'support_ticket',
    targetEntityId: parsed.data.ticketId,
    beforeState: { status: 'open' },
    afterState: { status: 'in_progress', claimedAt: now.toISOString() },
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}

// -----------------------------------------------------------------------------
// resolve — in_progress → resolved
// -----------------------------------------------------------------------------

const resolveSchema = z.object({
  ticketId: z.string().uuid(),
  // Optional closing note. Stored as a staff message so it shows in the
  // thread on /track; also surfaced to the customer via the resolve
  // WhatsApp nudge below.
  note: z.string().trim().min(1).max(2000).optional(),
});

export async function resolveTicketAction(
  input: z.infer<typeof resolveSchema>,
): Promise<ActionResult> {
  const auth = await requireAgent();
  if (!auth.ok) return auth;

  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input' };

  const before = await loadScopedTicket(parsed.data.ticketId, auth);
  if (!before) return { ok: false, error: 'Ticket not found' };

  // Allow super_admin to resolve straight from 'open' (skipping claim).
  // Useful when admin closes a ticket without taking ownership.
  const allowedFromStatuses: Array<'open' | 'in_progress'> =
    auth.role === 'super_admin' ? ['open', 'in_progress'] : ['in_progress'];

  if (!allowedFromStatuses.includes(before.status as 'open' | 'in_progress')) {
    return {
      ok: false,
      error: `Ticket is not in progress (currently ${before.status})`,
    };
  }

  const now = new Date();
  const updated = await db
    .update(supportTickets)
    .set({
      status: 'resolved',
      resolvedAt: now,
      resolvedByUserId: auth.userId,
      updatedAt: now,
    })
    .where(
      and(
        eq(supportTickets.id, parsed.data.ticketId),
        inArray(supportTickets.status, allowedFromStatuses),
      ),
    )
    .returning({ id: supportTickets.id });

  if (updated.length === 0) {
    return {
      ok: false,
      error: 'Ticket changed state just now — refresh to see the latest',
    };
  }

  // Optional closing note → staff message in the thread (visible on /track).
  if (parsed.data.note) {
    await db.insert(supportTicketMessages).values({
      ticketId: parsed.data.ticketId,
      authorKind: 'staff',
      authorUserId: auth.userId,
      body: parsed.data.note,
    });
    await logEvent({
      eventType: 'support_ticket_message_added',
      actorUserId: auth.userId,
      actorRole: auth.role,
      targetEntityType: 'support_ticket',
      targetEntityId: parsed.data.ticketId,
      afterState: { authorKind: 'staff', context: 'resolution_note' },
    });
  }

  await logEvent({
    eventType: 'support_ticket_resolved',
    actorUserId: auth.userId,
    actorRole: auth.role,
    targetEntityType: 'support_ticket',
    targetEntityId: parsed.data.ticketId,
    beforeState: { status: before.status },
    afterState: { status: 'resolved', resolvedAt: now.toISOString() },
  });

  // Customer notify — the callback the /track UI has always promised.
  // WhatsApp only (customer has no in-app login), opt-in gated in the
  // engine. Fire-and-forget; the resolve succeeds regardless of delivery.
  setImmediate(() => {
    void dispatchNotification('customer.support_ticket_resolved', {
      ticketId: parsed.data.ticketId,
      requestId: before.requestId,
      subject: before.subject,
      customerName: before.customerName,
      customerPhone: before.customerPhone,
      customerWhatsappOptIn: before.whatsappOptIn,
      trackingToken: before.trackingToken,
    }).catch((err) => {
      log.warn(
        { err: err instanceof Error ? err.message : String(err), ticketId: parsed.data.ticketId },
        'support_ticket_resolved_notify_failed',
      );
    });
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}

// -----------------------------------------------------------------------------
// reply — staff appends a message to the thread (any status)
// -----------------------------------------------------------------------------

const replySchema = z.object({
  ticketId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});

export async function replyToTicketAction(
  input: z.infer<typeof replySchema>,
): Promise<ActionResult<{ messageId: string }>> {
  const auth = await requireAgent();
  if (!auth.ok) return auth;

  const parsed = replySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  // Same scope boundary as claim/resolve — the caller must be able to SEE
  // the ticket. Returns 'Ticket not found' for both missing + out-of-scope.
  const ticket = await loadScopedTicket(parsed.data.ticketId, auth);
  if (!ticket) return { ok: false, error: 'Ticket not found' };

  const [row] = await db
    .insert(supportTicketMessages)
    .values({
      ticketId: parsed.data.ticketId,
      authorKind: 'staff',
      authorUserId: auth.userId,
      body: parsed.data.body,
    })
    .returning({ id: supportTicketMessages.id });

  await logEvent({
    eventType: 'support_ticket_message_added',
    actorUserId: auth.userId,
    actorRole: auth.role,
    targetEntityType: 'support_ticket',
    targetEntityId: parsed.data.ticketId,
    afterState: { authorKind: 'staff', context: 'reply' },
  });

  // A staff reply surfaces on /track; we intentionally do NOT WhatsApp the
  // customer per-reply (only on resolve) to avoid over-notifying mid-thread.
  revalidatePath('/', 'layout');
  return { ok: true, data: { messageId: row.id } };
}

// -----------------------------------------------------------------------------
// loadTicketThreadAction — scoped thread load for the expandable staff row
// -----------------------------------------------------------------------------

export async function loadTicketThreadAction(
  input: z.infer<typeof idSchema>,
): Promise<ActionResult<{ messages: TicketMessageRow[] }>> {
  const auth = await requireAgent();
  if (!auth.ok) return auth;

  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input' };

  const ticket = await loadScopedTicket(parsed.data.ticketId, auth);
  if (!ticket) return { ok: false, error: 'Ticket not found' };

  const messages = await loadTicketMessages(parsed.data.ticketId);
  return { ok: true, data: { messages } };
}
