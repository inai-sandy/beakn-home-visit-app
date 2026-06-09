'use server';

import { and, eq, inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db/client';
import { supportTickets, visitRequests } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';

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
    })
    .from(supportTickets)
    .innerJoin(visitRequests, eq(visitRequests.id, supportTickets.requestId))
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

export async function resolveTicketAction(
  input: z.infer<typeof idSchema>,
): Promise<ActionResult> {
  const auth = await requireAgent();
  if (!auth.ok) return auth;

  const parsed = idSchema.safeParse(input);
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

  await logEvent({
    eventType: 'support_ticket_resolved',
    actorUserId: auth.userId,
    actorRole: auth.role,
    targetEntityType: 'support_ticket',
    targetEntityId: parsed.data.ticketId,
    beforeState: { status: before.status },
    afterState: { status: 'resolved', resolvedAt: now.toISOString() },
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}
