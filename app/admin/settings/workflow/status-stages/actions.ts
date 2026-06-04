'use server';

import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db/client';
import { statusStages, visitRequests } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { logEvent } from '@/lib/audit';

// =============================================================================
// HVA-222: admin status_stages CRUD — server actions
// =============================================================================
//
// Sandeep 2026-06-04 — first slice of admin-configurable workflow.
// `code` is immutable (FKs + lib/status-transition.ts constants depend on it).
// `name` / `sequence_number` / `is_active` / `is_terminal` / `description`
// are admin-editable.
//
// All actions are super_admin-gated + audited via the
// `status_stage_changed` event type. `before_state` + `after_state` JSON
// captures the diff so the audit trail is reconstructable.
// =============================================================================

export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

async function requireSuperAdmin() {
  const session = await getServerSession();
  if (!session) return { ok: false as const, error: 'Not signed in' };
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'super_admin') {
    return { ok: false as const, error: 'Forbidden' };
  }
  return { ok: true as const, userId: user.id };
}

// -----------------------------------------------------------------------------
// Update — name / sequence / is_active / is_terminal / description
// -----------------------------------------------------------------------------

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  sequenceNumber: z.number().int().min(0).max(999),
  isActive: z.boolean(),
  isTerminal: z.boolean(),
  description: z.string().trim().max(2000).nullable(),
});

export async function updateStatusStageAction(
  input: z.infer<typeof updateSchema>,
): Promise<ActionResult> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const [before] = await db
    .select({
      id: statusStages.id,
      code: statusStages.code,
      name: statusStages.name,
      sequenceNumber: statusStages.sequenceNumber,
      isActive: statusStages.isActive,
      isTerminal: statusStages.isTerminal,
      description: statusStages.description,
    })
    .from(statusStages)
    .where(eq(statusStages.id, parsed.data.id))
    .limit(1);

  if (!before) return { ok: false, error: 'Stage not found' };

  await db
    .update(statusStages)
    .set({
      name: parsed.data.name,
      sequenceNumber: parsed.data.sequenceNumber,
      isActive: parsed.data.isActive,
      isTerminal: parsed.data.isTerminal,
      description: parsed.data.description,
      updatedAt: new Date(),
    })
    .where(eq(statusStages.id, parsed.data.id));

  await logEvent({
    eventType: 'status_stage_changed',
    actorUserId: auth.userId,
    targetEntityType: 'status_stage',
    targetEntityId: parsed.data.id,
    beforeState: {
      name: before.name,
      sequenceNumber: before.sequenceNumber,
      isActive: before.isActive,
      isTerminal: before.isTerminal,
      description: before.description,
    },
    afterState: {
      code: before.code,
      name: parsed.data.name,
      sequenceNumber: parsed.data.sequenceNumber,
      isActive: parsed.data.isActive,
      isTerminal: parsed.data.isTerminal,
      description: parsed.data.description,
    },
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}

// -----------------------------------------------------------------------------
// Create
// -----------------------------------------------------------------------------

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(
      /^[A-Z][A-Z0-9_]{0,63}$/,
      'Code must be UPPER_SNAKE_CASE (letters, digits, underscores; start with a letter; max 64 chars)',
    ),
  name: z.string().trim().min(1).max(100),
  sequenceNumber: z.number().int().min(0).max(999),
  isActive: z.boolean(),
  isTerminal: z.boolean(),
  description: z.string().trim().max(2000).nullable(),
});

export async function createStatusStageAction(
  input: z.infer<typeof createSchema>,
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  // Uniqueness check on `code` — surface a friendly message before the
  // DB throws.
  const [existing] = await db
    .select({ id: statusStages.id })
    .from(statusStages)
    .where(eq(statusStages.code, parsed.data.code))
    .limit(1);
  if (existing) {
    return { ok: false, error: `Stage code "${parsed.data.code}" already exists` };
  }

  const [row] = await db
    .insert(statusStages)
    .values({
      code: parsed.data.code,
      name: parsed.data.name,
      sequenceNumber: parsed.data.sequenceNumber,
      isActive: parsed.data.isActive,
      isTerminal: parsed.data.isTerminal,
      description: parsed.data.description,
    })
    .returning({ id: statusStages.id });

  await logEvent({
    eventType: 'status_stage_changed',
    actorUserId: auth.userId,
    targetEntityType: 'status_stage',
    targetEntityId: row.id,
    beforeState: null,
    afterState: {
      code: parsed.data.code,
      name: parsed.data.name,
      sequenceNumber: parsed.data.sequenceNumber,
      isActive: parsed.data.isActive,
      isTerminal: parsed.data.isTerminal,
      description: parsed.data.description,
    },
  });

  revalidatePath('/', 'layout');
  return { ok: true, data: { id: row.id } };
}

// -----------------------------------------------------------------------------
// Delete — only if no requests reference this stage
// -----------------------------------------------------------------------------

const deleteSchema = z.object({ id: z.string().uuid() });

export async function deleteStatusStageAction(
  input: z.infer<typeof deleteSchema>,
): Promise<ActionResult> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid input' };

  const [stage] = await db
    .select({
      id: statusStages.id,
      code: statusStages.code,
      name: statusStages.name,
      sequenceNumber: statusStages.sequenceNumber,
      isActive: statusStages.isActive,
      isTerminal: statusStages.isTerminal,
      description: statusStages.description,
    })
    .from(statusStages)
    .where(eq(statusStages.id, parsed.data.id))
    .limit(1);

  if (!stage) return { ok: false, error: 'Stage not found' };

  // Defence-in-depth: even though the FK on visit_requests.status_stage_id
  // is RESTRICT by default, surface a friendly count-based message here
  // BEFORE the DB throws. Includes both active and cancelled rows so
  // admins see the true usage.
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(visitRequests)
    .where(eq(visitRequests.statusStageId, parsed.data.id));

  if (count > 0) {
    return {
      ok: false,
      error: `Cannot delete — ${count} request${count === 1 ? '' : 's'} still reference this stage`,
    };
  }

  await db.delete(statusStages).where(eq(statusStages.id, parsed.data.id));

  await logEvent({
    eventType: 'status_stage_changed',
    actorUserId: auth.userId,
    targetEntityType: 'status_stage',
    targetEntityId: parsed.data.id,
    beforeState: {
      code: stage.code,
      name: stage.name,
      sequenceNumber: stage.sequenceNumber,
      isActive: stage.isActive,
      isTerminal: stage.isTerminal,
      description: stage.description,
    },
    afterState: null,
    reason: 'deleted',
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}
