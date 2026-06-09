'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db/client';
import { supportTickets } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';

// =============================================================================
// HVA-255 (HVA-232 Phase 2): claim + resolve server actions
// =============================================================================
//
// Auth: sales_executive / captain / super_admin. We DO NOT enforce that
// the caller owns the request — first-claim model wins. The order
// already pre-scopes the queue (exec sees only their own, etc.); the
// action layer just verifies the role.
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

  const [before] = await db
    .select({
      id: supportTickets.id,
      status: supportTickets.status,
      claimedByUserId: supportTickets.claimedByUserId,
    })
    .from(supportTickets)
    .where(eq(supportTickets.id, parsed.data.ticketId))
    .limit(1);

  if (!before) return { ok: false, error: 'Ticket not found' };
  if (before.status !== 'open') {
    return {
      ok: false,
      error: `Ticket is already ${before.status === 'in_progress' ? 'in progress' : before.status}`,
    };
  }

  const now = new Date();
  await db
    .update(supportTickets)
    .set({
      status: 'in_progress',
      claimedAt: now,
      claimedByUserId: auth.userId,
      updatedAt: now,
    })
    .where(eq(supportTickets.id, parsed.data.ticketId));

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

  const [before] = await db
    .select({
      id: supportTickets.id,
      status: supportTickets.status,
    })
    .from(supportTickets)
    .where(eq(supportTickets.id, parsed.data.ticketId))
    .limit(1);

  if (!before) return { ok: false, error: 'Ticket not found' };
  if (before.status !== 'in_progress') {
    // Allow super_admin to resolve straight from 'open' (skipping claim).
    // Useful when admin closes a ticket without taking ownership.
    if (!(auth.role === 'super_admin' && before.status === 'open')) {
      return {
        ok: false,
        error: `Ticket is not in progress (currently ${before.status})`,
      };
    }
  }

  const now = new Date();
  await db
    .update(supportTickets)
    .set({
      status: 'resolved',
      resolvedAt: now,
      resolvedByUserId: auth.userId,
      updatedAt: now,
    })
    .where(eq(supportTickets.id, parsed.data.ticketId));

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
