'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { alias } from 'drizzle-orm/pg-core';

import { db } from '@/db/client';
import { statusStages, statusTransitions } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { logEvent } from '@/lib/audit';

// =============================================================================
// HVA-223 + HVA-225: status_transitions admin actions
// =============================================================================
//
// HVA-225 lifted the Phase A guard — every flag on a transition row is
// now editable + enforced by lib/status-transition.ts. Two actions:
//   - setTransitionRequiresDatetimeAction (kept; thin wrapper around the
//     generalised action so per-cell switch UI still works)
//   - updateTransitionAction (full per-row patch)
// =============================================================================

const TASK_TYPE_ENUM = [
  'customer_home_visit',
  'sales_pitch',
  'outlet_visit',
  'follow_up',
  'installation',
  'stall_activity',
  'other',
] as const;

const ALLOWED_ROLE_ENUM = [
  'sales_executive',
  'captain',
  'super_admin',
  'any',
] as const;

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireSuperAdmin() {
  const session = await getServerSession();
  if (!session) return { ok: false as const, error: 'Not signed in' };
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') {
    return { ok: false as const, error: 'Forbidden' };
  }
  return { ok: true as const, userId: user.id };
}

// HVA-225 — full per-row patch.
const updateSchema = z.object({
  id: z.string().uuid(),
  allowedRole: z.enum(ALLOWED_ROLE_ENUM),
  requiresReason: z.boolean(),
  requiresQuotation: z.boolean(),
  requiresDatetime: z.boolean(),
  autoTaskType: z.enum(TASK_TYPE_ENUM).nullable(),
  isActive: z.boolean(),
  description: z.string().trim().max(2000).nullable(),
});

export async function updateTransitionAction(
  input: z.infer<typeof updateSchema>,
): Promise<ActionResult> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }

  const toStage = alias(statusStages, 'to_stage');
  const [before] = await db
    .select({
      id: statusTransitions.id,
      allowedRole: statusTransitions.allowedRole,
      requiresReason: statusTransitions.requiresReason,
      requiresQuotation: statusTransitions.requiresQuotation,
      requiresDatetime: statusTransitions.requiresDatetime,
      autoTaskType: statusTransitions.autoTaskType,
      isActive: statusTransitions.isActive,
      description: statusTransitions.description,
      toCode: toStage.code,
    })
    .from(statusTransitions)
    .innerJoin(toStage, eq(toStage.id, statusTransitions.toStageId))
    .where(eq(statusTransitions.id, parsed.data.id))
    .limit(1);

  if (!before) return { ok: false, error: 'Transition not found' };

  // HVA-253 (lifts the original HVA-226 placeholder): the schedule
  // action is now generic — it reads the transition's auto_task_type and
  // emits_event, only writes visit_scheduled_at on the VISIT_SCHEDULED
  // move. So the old toCode !== 'VISIT_SCHEDULED' guard is gone.
  //
  // New sanity check: the calendar's output is the auto-created task, so
  // turning requires_datetime on with no auto_task_type has no useful
  // effect (picker would open then create nothing). Refuse with a clear
  // message.
  if (
    parsed.data.requiresDatetime &&
    !(parsed.data.autoTaskType && parsed.data.autoTaskType.length > 0)
  ) {
    return {
      ok: false,
      error:
        'Set an auto-task type first — the calendar picker creates a task on the chosen date, so without one it has nothing to do.',
    };
  }

  await db
    .update(statusTransitions)
    .set({
      allowedRole: parsed.data.allowedRole,
      requiresReason: parsed.data.requiresReason,
      requiresQuotation: parsed.data.requiresQuotation,
      requiresDatetime: parsed.data.requiresDatetime,
      autoTaskType: parsed.data.autoTaskType,
      isActive: parsed.data.isActive,
      description: parsed.data.description,
      updatedAt: new Date(),
    })
    .where(eq(statusTransitions.id, parsed.data.id));

  await logEvent({
    eventType: 'status_transition_changed',
    actorUserId: auth.userId,
    targetEntityType: 'status_transition',
    targetEntityId: parsed.data.id,
    beforeState: {
      allowedRole: before.allowedRole,
      requiresReason: before.requiresReason,
      requiresQuotation: before.requiresQuotation,
      requiresDatetime: before.requiresDatetime,
      autoTaskType: before.autoTaskType,
      isActive: before.isActive,
      description: before.description,
    },
    afterState: {
      allowedRole: parsed.data.allowedRole,
      requiresReason: parsed.data.requiresReason,
      requiresQuotation: parsed.data.requiresQuotation,
      requiresDatetime: parsed.data.requiresDatetime,
      autoTaskType: parsed.data.autoTaskType,
      isActive: parsed.data.isActive,
      description: parsed.data.description,
    },
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}

// HVA-223 wrapper kept so the existing per-cell switch in
// TransitionsClient.tsx keeps working without a UI rewrite. Forwards to
// updateTransitionAction with the other fields preserved.
const switchSchema = z.object({
  id: z.string().uuid(),
  requiresDatetime: z.boolean(),
});

export async function setTransitionRequiresDatetimeAction(
  input: z.infer<typeof switchSchema>,
): Promise<ActionResult> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = switchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input' };

  const [row] = await db
    .select({
      id: statusTransitions.id,
      allowedRole: statusTransitions.allowedRole,
      requiresReason: statusTransitions.requiresReason,
      requiresQuotation: statusTransitions.requiresQuotation,
      autoTaskType: statusTransitions.autoTaskType,
      isActive: statusTransitions.isActive,
      description: statusTransitions.description,
    })
    .from(statusTransitions)
    .where(eq(statusTransitions.id, parsed.data.id))
    .limit(1);
  if (!row) return { ok: false, error: 'Transition not found' };

  return updateTransitionAction({
    id: row.id,
    allowedRole: row.allowedRole as 'sales_executive' | 'captain' | 'super_admin' | 'any',
    requiresReason: row.requiresReason,
    requiresQuotation: row.requiresQuotation,
    requiresDatetime: parsed.data.requiresDatetime,
    autoTaskType: row.autoTaskType as
      | (typeof TASK_TYPE_ENUM)[number]
      | null,
    isActive: row.isActive,
    description: row.description,
  });
}
