'use server';

import { desc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { dispatchStatusHistory, dispatches } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import {
  advanceDispatchStageSchema,
  NEXT_STAGE,
  type AdvanceDispatchStageInput,
  type DispatchStage,
} from '@/lib/validators/dispatch-stage';

// =============================================================================
// HVA-239 (HVA-231 Phase 2 PR-B): advanceDispatchStageAction
// =============================================================================
//
// Flips a dispatch's lifecycle stage forward by exactly one step:
//   created → packed → handed_off
//
// Auth: support OR super_admin.
//
// Validation:
//   - Zod (dispatchId UUID, toStage enum)
//   - Dispatch exists
//   - Current stage = predecessor of toStage (no skipping; no reverse)
//   - UNIQUE(dispatch_id, stage) at the DB level enforces no double-flip
//
// On success: INSERT dispatch_status_history row, emit audit event,
// revalidate /support/* + /requests/[id].
// =============================================================================

const ALLOWED_ROLES = [USER_ROLES.SUPPORT, USER_ROLES.SUPER_ADMIN] as const;

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

export async function advanceDispatchStageAction(
  input: AdvanceDispatchStageInput,
): Promise<ActionResult> {
  const session = await getServerSession();
  if (!session) return { ok: false, error: 'Not signed in' };
  const user = session.user as { id: string; role?: string };
  if (
    !user.role ||
    !ALLOWED_ROLES.includes(user.role as (typeof ALLOWED_ROLES)[number])
  ) {
    return { ok: false, error: 'Forbidden' };
  }

  const parsed = advanceDispatchStageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid input' };
  }
  const { dispatchId, toStage } = parsed.data;

  const [dispatch] = await db
    .select({ id: dispatches.id })
    .from(dispatches)
    .where(eq(dispatches.id, dispatchId))
    .limit(1);
  if (!dispatch) return { ok: false, error: 'Dispatch not found' };

  // Current stage = latest history row.
  const [latest] = await db
    .select({
      stage: dispatchStatusHistory.stage,
      changedAt: dispatchStatusHistory.changedAt,
    })
    .from(dispatchStatusHistory)
    .where(eq(dispatchStatusHistory.dispatchId, dispatchId))
    .orderBy(desc(dispatchStatusHistory.changedAt))
    .limit(1);

  const currentStage: DispatchStage = latest?.stage ?? 'created';
  const expectedTo = NEXT_STAGE[currentStage];
  if (!expectedTo) {
    return {
      ok: false,
      error: `Dispatch is already at the final stage (${currentStage}).`,
    };
  }
  if (expectedTo !== toStage) {
    return {
      ok: false,
      error: `Cannot advance to ${toStage} from ${currentStage}. Next allowed step is ${expectedTo}.`,
    };
  }

  try {
    await db.insert(dispatchStatusHistory).values({
      dispatchId,
      stage: toStage,
      changedByUserId: user.id,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not advance stage.',
    };
  }

  await logEvent({
    eventType: 'dispatch_advanced',
    actorUserId: user.id,
    actorRole: user.role as (typeof ALLOWED_ROLES)[number],
    targetEntityType: 'dispatch',
    targetEntityId: dispatchId,
    beforeState: { stage: currentStage },
    afterState: { stage: toStage },
    ipAddress: null,
    userAgent: null,
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}
