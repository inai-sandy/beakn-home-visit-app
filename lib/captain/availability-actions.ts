'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db/client';
import { execUnavailabilitySchedules, salesExecutives } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES, isRole } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';

// =============================================================================
// PR10 2026-05-26: captain-side actions for scheduled exec unavailability
// =============================================================================
//
// Auth: super_admin always; captain only when the target exec reports
// to them (mirrors lib/captain/team-actions.ts).
//
// Date range stored verbatim as YYYY-MM-DD strings (Drizzle `date`
// type). Validator caps reason at 200 chars. start ≤ end is enforced
// at both the DB (CHECK) and the validator.
// =============================================================================

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const addSchema = z
  .object({
    execUserId: z.string().uuid(),
    startDate: z.string().regex(ISO_DATE, 'Use YYYY-MM-DD'),
    endDate: z.string().regex(ISO_DATE, 'Use YYYY-MM-DD'),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.startDate <= v.endDate, {
    message: 'Start date must be on or before end date',
    path: ['startDate'],
  });

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

async function authorizeForExec(
  execUserId: string,
): Promise<
  | { ok: true; actor: { id: string; role: string } }
  | { ok: false; error: string }
> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const actor = session.user as { id: string; role?: string };
  if (!isRole(actor.role)) return { ok: false, error: 'Forbidden' };

  if (actor.role === USER_ROLES.SUPER_ADMIN) {
    return { ok: true, actor: { id: actor.id, role: actor.role } };
  }
  if (actor.role !== USER_ROLES.CAPTAIN) {
    return { ok: false, error: 'Forbidden' };
  }
  const [row] = await db
    .select({ captainUserId: salesExecutives.captainUserId })
    .from(salesExecutives)
    .where(eq(salesExecutives.userId, execUserId))
    .limit(1);
  if (!row) return { ok: false, error: 'Exec not found' };
  if (row.captainUserId !== actor.id) {
    return { ok: false, error: 'Not allowed' };
  }
  return { ok: true, actor: { id: actor.id, role: actor.role } };
}

export async function addExecUnavailabilityScheduleAction(
  input: z.infer<typeof addSchema>,
): Promise<ActionResult<{ scheduleId: string }>> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
      fieldErrors,
    };
  }
  const data = parsed.data;

  const authz = await authorizeForExec(data.execUserId);
  if (!authz.ok) return { ok: false, error: authz.error };

  const [inserted] = await db
    .insert(execUnavailabilitySchedules)
    .values({
      execUserId: data.execUserId,
      startDate: data.startDate,
      endDate: data.endDate,
      reason: data.reason && data.reason.length > 0 ? data.reason : null,
      createdByUserId: authz.actor.id,
    })
    .returning({ id: execUnavailabilitySchedules.id });

  await logEvent({
    eventType: 'exec_unavailability_scheduled',
    actorUserId: authz.actor.id,
    actorRole: isRole(authz.actor.role) ? authz.actor.role : null,
    targetEntityType: 'sales_executive',
    targetEntityId: data.execUserId,
    afterState: {
      scheduleId: inserted.id,
      startDate: data.startDate,
      endDate: data.endDate,
      reason: data.reason ?? null,
    },
  });

  // Layout-level revalidate so dashboard, team list, exec detail, +
  // assign/reassign dropdowns all pick up the change.
  revalidatePath('/', 'layout');
  return { ok: true, data: { scheduleId: inserted.id } };
}

const removeSchema = z.object({
  execUserId: z.string().uuid(),
  scheduleId: z.string().uuid(),
});

export async function removeExecUnavailabilityScheduleAction(
  input: z.infer<typeof removeSchema>,
): Promise<ActionResult> {
  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const data = parsed.data;

  const authz = await authorizeForExec(data.execUserId);
  if (!authz.ok) return { ok: false, error: authz.error };

  // Load the row first so the audit event captures the deleted state.
  const [existing] = await db
    .select({
      id: execUnavailabilitySchedules.id,
      startDate: execUnavailabilitySchedules.startDate,
      endDate: execUnavailabilitySchedules.endDate,
      reason: execUnavailabilitySchedules.reason,
    })
    .from(execUnavailabilitySchedules)
    .where(
      and(
        eq(execUnavailabilitySchedules.id, data.scheduleId),
        eq(execUnavailabilitySchedules.execUserId, data.execUserId),
      ),
    )
    .limit(1);
  if (!existing) {
    return { ok: false, error: 'Schedule not found' };
  }

  await db
    .delete(execUnavailabilitySchedules)
    .where(eq(execUnavailabilitySchedules.id, data.scheduleId));

  await logEvent({
    eventType: 'exec_unavailability_schedule_removed',
    actorUserId: authz.actor.id,
    actorRole: isRole(authz.actor.role) ? authz.actor.role : null,
    targetEntityType: 'sales_executive',
    targetEntityId: data.execUserId,
    beforeState: {
      scheduleId: existing.id,
      startDate: existing.startDate,
      endDate: existing.endDate,
      reason: existing.reason,
    },
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}
