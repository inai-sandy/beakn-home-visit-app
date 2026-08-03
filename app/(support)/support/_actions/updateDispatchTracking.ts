'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { db } from '@/db/client';
import { dispatches } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { USER_ROLES } from '@/lib/auth/roles';
import { getServerSession } from '@/lib/auth-server';
import {
  updateDispatchTrackingSchema,
  type UpdateDispatchTrackingInput,
} from '@/lib/validators/dispatch';

// =============================================================================
// HVA-303: updateDispatchTrackingAction
// =============================================================================
//
// Sets or corrects the courier name + tracking number on an existing
// dispatch.
//
// Why this exists rather than capture-at-creation only: support records the
// dispatch when the package is picked and packed, which is routinely BEFORE
// the courier is booked and the AWB issued. Without an after-the-fact edit
// the tracking number would have to be guessed at creation or never
// recorded at all — and the exec would be back to phoning support.
//
// Auth: support OR super_admin (same as every other dispatch action).
//
// This is an UPDATE, not a delete — the no-deletes rule is untouched.
// Clearing a field is legitimate (a mistyped AWB must be removable), so
// blank input writes NULL rather than being ignored. The before/after pair
// lands in the audit log, so a correction is always traceable.
// =============================================================================

const ALLOWED_ROLES = [USER_ROLES.SUPPORT, USER_ROLES.SUPER_ADMIN] as const;

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export async function updateDispatchTrackingAction(
  input: UpdateDispatchTrackingInput,
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

  const parsed = updateDispatchTrackingSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.join('.');
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message;
    }
    return { ok: false, error: 'Some fields are invalid.', fieldErrors };
  }
  const { dispatchId, courierName, trackingNumber } = parsed.data;

  const [existing] = await db
    .select({
      id: dispatches.id,
      courierName: dispatches.courierName,
      trackingNumber: dispatches.trackingNumber,
    })
    .from(dispatches)
    .where(eq(dispatches.id, dispatchId))
    .limit(1);

  if (!existing) return { ok: false, error: 'Dispatch not found' };

  const nextCourierName = courierName?.trim() || null;
  const nextTrackingNumber = trackingNumber?.trim() || null;

  if (
    nextCourierName === existing.courierName &&
    nextTrackingNumber === existing.trackingNumber
  ) {
    // Nothing changed — skip the write and the audit row rather than
    // filling the log with no-op entries.
    return { ok: true };
  }

  try {
    // Narrow update: only the two courier columns are listed, so nothing
    // else on the row can be nulled by accident (see CLAUDE.md bug family 5).
    await db
      .update(dispatches)
      .set({
        courierName: nextCourierName,
        trackingNumber: nextTrackingNumber,
      })
      .where(eq(dispatches.id, dispatchId));
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : 'Service temporarily unavailable.',
    };
  }

  await logEvent({
    eventType: 'dispatch_tracking_updated',
    actorUserId: user.id,
    actorRole: user.role as (typeof ALLOWED_ROLES)[number],
    targetEntityType: 'dispatch',
    targetEntityId: dispatchId,
    beforeState: {
      courierName: existing.courierName,
      trackingNumber: existing.trackingNumber,
    },
    afterState: {
      courierName: nextCourierName,
      trackingNumber: nextTrackingNumber,
    },
    ipAddress: null,
    userAgent: null,
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}
