'use server';

import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db/client';
import {
  requestExecAssignments,
  salesExecutives,
  users,
  visitRequests,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import { dispatchNotification } from '@/lib/notifications/engine';

// =============================================================================
// HVA-85: rebalance flow — captain reassigns the future-scheduled visits
// of an exec they just marked unavailable
// =============================================================================
//
// The MarkUnavailableToggle flips sales_executives.is_unavailable. This
// helper fetches the affected future visits + lists the captain's other
// active execs as the destination pool. A separate bulk action commits
// the per-visit reassignments in a transaction.
//
// Auth: captain owning the source exec OR super_admin. The captain
// cannot reassign to an exec on a different team.
// =============================================================================

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function authorizeCaptainOrAdmin(): Promise<
  { ok: true; actorId: string; isAdmin: boolean } | { ok: false; error: string }
> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const u = session.user as { id: string; role?: string };
  if (u.role !== USER_ROLES.CAPTAIN && u.role !== USER_ROLES.SUPER_ADMIN) {
    return { ok: false, error: 'Forbidden' };
  }
  return {
    ok: true,
    actorId: u.id,
    isAdmin: u.role === USER_ROLES.SUPER_ADMIN,
  };
}

export interface AffectedVisitRow {
  requestId: string;
  customerName: string;
  visitScheduledAt: Date | null;
}

/**
 * Future visits currently assigned to this exec — used by the rebalance
 * modal to ask the captain to redistribute work before/after marking the
 * exec unavailable.
 *
 * "Future" = visit_scheduled_at > now() AND not yet cancelled.
 */
export async function loadAffectedFutureVisitsForExec(
  execUserId: string,
): Promise<AffectedVisitRow[]> {
  const auth = await authorizeCaptainOrAdmin();
  if (!auth.ok) return [];

  if (!auth.isAdmin) {
    const [se] = await db
      .select({ captainUserId: salesExecutives.captainUserId })
      .from(salesExecutives)
      .where(eq(salesExecutives.userId, execUserId))
      .limit(1);
    if (!se || se.captainUserId !== auth.actorId) return [];
  }

  const rows = await db
    .select({
      requestId: visitRequests.id,
      customerName: visitRequests.customerName,
      visitScheduledAt: visitRequests.visitScheduledAt,
    })
    .from(visitRequests)
    .where(
      and(
        eq(visitRequests.assignedExecUserId, execUserId),
        isNull(visitRequests.cancelledAt),
        gt(visitRequests.visitScheduledAt, new Date()),
      ),
    )
    .orderBy(visitRequests.visitScheduledAt);

  return rows;
}

/** Other active execs on the captain's team — destinations for rebalance. */
export async function loadTeammatesForRebalance(
  captainUserId: string,
  excludeExecUserId: string,
) {
  return db
    .select({
      id: users.id,
      fullName: users.fullName,
    })
    .from(salesExecutives)
    .innerJoin(users, eq(users.id, salesExecutives.userId))
    .where(
      and(
        eq(salesExecutives.captainUserId, captainUserId),
        eq(users.isActive, true),
        eq(salesExecutives.isUnavailable, false),
      ),
    )
    .orderBy(users.fullName);
}

const bulkReassignSchema = z.object({
  fromExecUserId: z.string().uuid(),
  reassignments: z
    .array(
      z.object({
        requestId: z.string().uuid(),
        toExecUserId: z.string().uuid(),
      }),
    )
    .min(1, 'Pick at least one visit to reassign')
    .max(50, 'Too many visits — split across multiple submits'),
  reason: z
    .string()
    .trim()
    .min(20, 'Reason must be at least 20 characters')
    .max(500, 'Reason must be 500 characters or fewer'),
});

export type BulkReassignInput = z.infer<typeof bulkReassignSchema>;

/**
 * Bulk-reassigns N visits in a single transaction. Mirrors the
 * /api/requests/[id]/reassign route's per-visit semantics but compresses
 * the per-row work into one tx + N audit events.
 */
export async function bulkReassignAffectedVisitsAction(
  input: BulkReassignInput,
): Promise<ActionResult<{ reassignedCount: number }>> {
  const auth = await authorizeCaptainOrAdmin();
  if (!auth.ok) return auth;

  const parsed = bulkReassignSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const data = parsed.data;

  // Captain owns the from-exec?
  if (!auth.isAdmin) {
    const [se] = await db
      .select({ captainUserId: salesExecutives.captainUserId })
      .from(salesExecutives)
      .where(eq(salesExecutives.userId, data.fromExecUserId))
      .limit(1);
    if (!se || se.captainUserId !== auth.actorId) {
      return { ok: false, error: 'Forbidden — not your team' };
    }
  }

  // Validate every destination exec is on the captain's team + active.
  const destIds = Array.from(
    new Set(data.reassignments.map((r) => r.toExecUserId)),
  );
  for (const destId of destIds) {
    const [se] = await db
      .select({
        captainUserId: salesExecutives.captainUserId,
        isUnavailable: salesExecutives.isUnavailable,
        isActive: users.isActive,
      })
      .from(salesExecutives)
      .innerJoin(users, eq(users.id, salesExecutives.userId))
      .where(eq(salesExecutives.userId, destId))
      .limit(1);
    if (!se) {
      return { ok: false, error: 'Destination exec not found' };
    }
    if (!auth.isAdmin && se.captainUserId !== auth.actorId) {
      return {
        ok: false,
        error: 'Cannot reassign to an exec on a different team',
      };
    }
    if (!se.isActive || se.isUnavailable) {
      return {
        ok: false,
        error: 'Destination exec is inactive or unavailable',
      };
    }
  }

  // Transactional reassignment.
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      for (const r of data.reassignments) {
        await tx
          .update(visitRequests)
          .set({
            assignedExecUserId: r.toExecUserId,
            updatedAt: now,
          })
          .where(eq(visitRequests.id, r.requestId));

        await tx.insert(requestExecAssignments).values({
          requestId: r.requestId,
          fromExecUserId: data.fromExecUserId,
          toExecUserId: r.toExecUserId,
          captainUserId: auth.actorId,
          reason: data.reason,
        });
      }
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Service temporarily unavailable.',
    };
  }

  // Per-visit audit + notification. logEvent is gated by config; we
  // dispatch a single 'request.reassigned' event per visit so existing
  // notification rules still trigger as expected.
  for (const r of data.reassignments) {
    await logEvent({
      eventType: 'request_reassigned_by_unavailable_rebalance',
      actorUserId: auth.actorId,
      actorRole: auth.isAdmin ? 'super_admin' : 'captain',
      targetEntityType: 'visit_request',
      targetEntityId: r.requestId,
      afterState: {
        fromExecUserId: data.fromExecUserId,
        toExecUserId: r.toExecUserId,
        bulkRebalance: true,
      },
      reason: data.reason,
    });
    try {
      await dispatchNotification('request.reassigned', {
        requestId: r.requestId,
        fromExecUserId: data.fromExecUserId,
        toExecUserId: r.toExecUserId,
        reason: data.reason,
      });
    } catch {
      // Never block the response on notification engine failure.
    }
  }

  revalidatePath('/', 'layout');
  return { ok: true, data: { reassignedCount: data.reassignments.length } };
}
