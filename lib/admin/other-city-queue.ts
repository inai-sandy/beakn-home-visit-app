'use server';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db/client';
import {
  captains,
  cities,
  requestStatusHistory,
  statusStages,
  users,
  visitRequests,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';

// =============================================================================
// HVA-95: Other City Requests queue — admin manually routes out-of-area
// requests to a captain
// =============================================================================
//
// When a customer submits a request from a city not in the 8-city list, the
// request gets city_id = (the "Other" city's id). Today nothing happens —
// admin has no UI to route those requests. This route + action add that.
// =============================================================================

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function authorizeSuperAdmin(): Promise<
  { ok: true; actorId: string } | { ok: false; error: string }
> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const u = session.user as { id: string; role?: string };
  if (u.role !== USER_ROLES.SUPER_ADMIN) {
    return { ok: false, error: 'Forbidden' };
  }
  return { ok: true, actorId: u.id };
}

export interface OtherCityRequestRow {
  id: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  address: string;
  customerState: string | null;
  bhk: string;
  interest: string[];
  createdAt: Date;
}

/**
 * Returns Other-bucket requests currently in Submitted (not yet routed).
 * Sorted oldest-first so the admin handles the longest-waiting requests
 * first.
 */
export async function loadOtherCityQueue(): Promise<OtherCityRequestRow[]> {
  const [otherCity] = await db
    .select({ id: cities.id })
    .from(cities)
    .where(eq(cities.name, 'Other'))
    .limit(1);
  if (!otherCity) return [];

  const [submittedStage] = await db
    .select({ id: statusStages.id })
    .from(statusStages)
    .where(eq(statusStages.code, 'SUBMITTED'))
    .limit(1);
  if (!submittedStage) return [];

  const rows = await db
    .select({
      id: visitRequests.id,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      customerEmail: visitRequests.customerEmail,
      address: visitRequests.address,
      customerState: visitRequests.customerState,
      bhk: visitRequests.bhk,
      interest: visitRequests.interest,
      createdAt: visitRequests.createdAt,
    })
    .from(visitRequests)
    .where(
      and(
        eq(visitRequests.cityId, otherCity.id),
        eq(visitRequests.statusStageId, submittedStage.id),
        isNull(visitRequests.cancelledAt),
        isNull(visitRequests.assignedCaptainUserId),
      ),
    )
    .orderBy(visitRequests.createdAt);

  return rows.map((r) => ({
    ...r,
    interest: r.interest ?? [],
  }));
}

/** Active captains, ordered by name. Drives the routing dropdown. */
export async function loadActiveCaptainsForRouting() {
  return db
    .select({
      id: users.id,
      fullName: users.fullName,
    })
    .from(captains)
    .innerJoin(users, eq(users.id, captains.userId))
    .where(eq(users.isActive, true))
    .orderBy(users.fullName);
}

const routeSchema = z.object({
  requestId: z.string().uuid(),
  toCaptainUserId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});

export type RouteOtherCityRequestInput = z.infer<typeof routeSchema>;

/**
 * Manually routes an Other-bucket request to a captain. Sets
 * assigned_captain_user_id, transitions SUBMITTED → ASSIGNED, records
 * history + audit. Captain then assigns to their exec via the normal flow.
 */
export async function routeOtherCityRequestAction(
  input: RouteOtherCityRequestInput,
): Promise<ActionResult> {
  const auth = await authorizeSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = routeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const data = parsed.data;

  // Verify the captain exists + is active.
  const [cap] = await db
    .select({ id: users.id, fullName: users.fullName, isActive: users.isActive })
    .from(captains)
    .innerJoin(users, eq(users.id, captains.userId))
    .where(eq(users.id, data.toCaptainUserId))
    .limit(1);
  if (!cap) return { ok: false, error: 'Captain not found' };
  if (!cap.isActive) {
    return { ok: false, error: 'Captain is inactive — pick another' };
  }

  // Load the request to verify it's still in the Other queue (not already
  // routed by another admin in a race).
  const [reqRow] = await db
    .select({
      id: visitRequests.id,
      statusStageId: visitRequests.statusStageId,
      statusStageCode: statusStages.code,
      currentStageSeq: statusStages.sequenceNumber,
      assignedCaptainUserId: visitRequests.assignedCaptainUserId,
      cancelledAt: visitRequests.cancelledAt,
    })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .where(eq(visitRequests.id, data.requestId))
    .limit(1);
  if (!reqRow) return { ok: false, error: 'Request not found' };
  if (reqRow.cancelledAt !== null) {
    return { ok: false, error: 'Request is cancelled — cannot route' };
  }
  if (reqRow.statusStageCode !== 'SUBMITTED') {
    return { ok: false, error: 'Request is already past Submitted' };
  }
  if (reqRow.assignedCaptainUserId !== null) {
    return { ok: false, error: 'Request is already routed to a captain' };
  }

  // Find the ASSIGNED stage id.
  const [assignedStage] = await db
    .select({ id: statusStages.id, sequenceNumber: statusStages.sequenceNumber })
    .from(statusStages)
    .where(eq(statusStages.code, 'ASSIGNED'))
    .limit(1);
  if (!assignedStage) {
    return { ok: false, error: 'ASSIGNED stage missing — schema seed drift' };
  }

  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(visitRequests)
        .set({
          assignedCaptainUserId: data.toCaptainUserId,
          assignedAt: now,
          statusStageId: assignedStage.id,
          updatedAt: now,
        })
        .where(eq(visitRequests.id, data.requestId));

      await tx.insert(requestStatusHistory).values({
        requestId: data.requestId,
        fromStatusStageId: reqRow.statusStageId,
        toStatusStageId: assignedStage.id,
        sequenceNumber: assignedStage.sequenceNumber,
        transitionOrder: sql`COALESCE((SELECT MAX(transition_order) FROM request_status_history WHERE request_id = ${data.requestId}), 0) + 1`,
        changedByUserId: auth.actorId,
        reason: data.reason
          ? `Manually routed from Other queue: ${data.reason}`
          : 'Manually routed from Other queue',
      });
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Service temporarily unavailable.',
    };
  }

  await logEvent({
    eventType: 'request_routed_from_other_queue',
    actorUserId: auth.actorId,
    actorRole: 'super_admin',
    targetEntityType: 'visit_request',
    targetEntityId: data.requestId,
    afterState: {
      toCaptainUserId: data.toCaptainUserId,
      toCaptainName: cap.fullName,
      reason: data.reason ?? null,
    },
    reason: data.reason ?? null,
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}
