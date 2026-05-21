'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { salesExecutives } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES, isRole } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';

// =============================================================================
// HVA-167: Mark Unavailable toggle — minimum viable writer
// =============================================================================
//
// Single boolean flip on sales_executives.is_unavailable. Auth: actor
// must be the exec's captain OR super_admin. Audit emits
// 'exec_availability_changed' with before/after states.
//
// HVA-85 will extend this with scheduled unavailability, partial-day,
// reason codes. Today's scope is: captain marks an exec unavailable
// for the moment; flag stays until someone (captain or admin) flips
// it back. The team list + dashboard + captain-assign route all read
// the flag.
// =============================================================================

export interface SetExecUnavailableInput {
  execUserId: string;
  isUnavailable: boolean;
}

export type SetExecUnavailableResult =
  | { ok: true; changed: boolean }
  | { ok: false; error: string };

export async function setExecUnavailableAction(
  input: SetExecUnavailableInput,
): Promise<SetExecUnavailableResult> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const actor = session.user as { id: string; role?: string };
  if (!isRole(actor.role)) return { ok: false, error: 'Forbidden' };

  // Load the target exec row + its captain link in a single query.
  const [row] = await db
    .select({
      userId: salesExecutives.userId,
      captainUserId: salesExecutives.captainUserId,
      isUnavailable: salesExecutives.isUnavailable,
    })
    .from(salesExecutives)
    .where(eq(salesExecutives.userId, input.execUserId))
    .limit(1);
  if (!row) return { ok: false, error: 'Exec not found' };

  // Auth: super_admin always; captain only when this exec reports to them.
  if (
    actor.role !== USER_ROLES.SUPER_ADMIN &&
    !(actor.role === USER_ROLES.CAPTAIN && row.captainUserId === actor.id)
  ) {
    return { ok: false, error: 'Not allowed' };
  }

  if (row.isUnavailable === input.isUnavailable) {
    return { ok: true, changed: false };
  }

  await db
    .update(salesExecutives)
    .set({ isUnavailable: input.isUnavailable })
    .where(eq(salesExecutives.userId, input.execUserId));

  await logEvent({
    eventType: 'exec_availability_changed',
    actorUserId: actor.id,
    actorRole: actor.role,
    targetEntityType: 'sales_executive',
    targetEntityId: input.execUserId,
    beforeState: { isUnavailable: row.isUnavailable },
    afterState: { isUnavailable: input.isUnavailable },
  });

  // Invalidate every surface that reads this flag.
  revalidatePath(`/captain/team/${input.execUserId}`);
  revalidatePath('/captain/team');
  revalidatePath('/captain/dashboard');
  return { ok: true, changed: true };
}
