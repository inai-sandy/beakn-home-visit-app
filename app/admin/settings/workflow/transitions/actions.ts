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
// HVA-223: status_transitions admin actions
// =============================================================================
//
// Phase A — only `requires_datetime` is editable (drives the
// AdvanceStatusButton calendar dialog). The other flags will become
// editable in HVA-225 when lib/status-transition.ts gets refactored to
// read enforcement from the table.
// =============================================================================

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

const schema = z.object({
  id: z.string().uuid(),
  requiresDatetime: z.boolean(),
});

export async function setTransitionRequiresDatetimeAction(
  input: z.infer<typeof schema>,
): Promise<ActionResult> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input' };

  const toStage = alias(statusStages, 'to_stage');
  const [before] = await db
    .select({
      id: statusTransitions.id,
      fromStageId: statusTransitions.fromStageId,
      toStageId: statusTransitions.toStageId,
      toCode: toStage.code,
      requiresDatetime: statusTransitions.requiresDatetime,
    })
    .from(statusTransitions)
    .innerJoin(toStage, eq(toStage.id, statusTransitions.toStageId))
    .where(eq(statusTransitions.id, parsed.data.id))
    .limit(1);

  if (!before) return { ok: false, error: 'Transition not found' };

  // HVA-223 Phase A guard: the calendar dialog + side-effect plumbing
  // (auto-task creation, visit_scheduled_at column) is only wired for
  // transitions whose target is VISIT_SCHEDULED. Enabling the picker on
  // other transitions would open the dialog but the submit would
  // currently fail. HVA-225 will generalise the side-effect mechanism so
  // any transition with auto_task_type set can carry a calendar.
  if (parsed.data.requiresDatetime && before.toCode !== 'VISIT_SCHEDULED') {
    return {
      ok: false,
      error:
        'Calendar picker is only wired for transitions to VISIT_SCHEDULED today. Enabling on other stages needs HVA-225 (generalised side-effect side).',
    };
  }

  await db
    .update(statusTransitions)
    .set({
      requiresDatetime: parsed.data.requiresDatetime,
      updatedAt: new Date(),
    })
    .where(eq(statusTransitions.id, parsed.data.id));

  await logEvent({
    eventType: 'status_transition_changed',
    actorUserId: auth.userId,
    targetEntityType: 'status_transition',
    targetEntityId: parsed.data.id,
    beforeState: { requiresDatetime: before.requiresDatetime },
    afterState: { requiresDatetime: parsed.data.requiresDatetime },
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}
