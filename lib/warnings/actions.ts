'use server';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { db } from '@/db/client';
import { salesExecutives, users, warnings } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { getServerSession } from '@/lib/auth-server';
import { log } from '@/lib/logger';
import { dispatchNotification } from '@/lib/notifications/engine';

import { composeWarningMessage } from './compose';
import {
  HARD_WARNING_FIRE_THRESHOLD,
  WARNING_METRICS,
  WARNING_PERIODS,
} from './metrics';

// =============================================================================
// HVA-228: warnings server actions
// =============================================================================
//
// Two write actions + one helper:
//   - issueWarningAction({execUserId, kind, metric, period, current, target, reason})
//   - revokeWarningAction({warningId, revokedReason})
//   - deactivateExecAction({execUserId, reason})  ← manual fire at 5/5
//
// All three are super_admin-gated. Each writes an audit row. After
// issue we fire the appropriate notification event via the engine —
// fire-and-forget (caught + logged inside dispatchNotification).
//
// The action returns the universal `ActionResult` so the dialog can
// render error toasts.
// =============================================================================

const actionLog = log.child({ component: 'warnings.actions' });

export type ActionResult<T = void> =
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

const metricCodes = WARNING_METRICS.map((m) => m.code) as [string, ...string[]];
const periodCodes = WARNING_PERIODS.map((p) => p.code) as [string, ...string[]];

const issueSchema = z.object({
  execUserId: z.string().uuid(),
  kind: z.enum(['soft', 'hard']),
  metricCode: z.enum(metricCodes),
  periodCode: z.enum(periodCodes),
  currentValue: z.number().int().nonnegative(),
  targetValue: z.number().int().nonnegative(),
  reason: z.string().trim().min(10).max(500),
});

export interface IssueWarningInput {
  execUserId: string;
  kind: 'soft' | 'hard';
  metricCode: string;
  periodCode: string;
  currentValue: number;
  targetValue: number;
  reason: string;
}

export async function issueWarningAction(
  input: IssueWarningInput,
): Promise<ActionResult<{ warningId: string; messageSnapshot: string }>> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }

  // Look up exec + captain names + period label for the message.
  const [execRow] = await db
    .select({
      execId: users.id,
      execName: users.fullName,
      execIsActive: users.isActive,
      captainId: salesExecutives.captainUserId,
    })
    .from(users)
    .leftJoin(salesExecutives, eq(salesExecutives.userId, users.id))
    .where(eq(users.id, parsed.data.execUserId))
    .limit(1);

  if (!execRow) return { ok: false, error: 'Exec not found' };
  if (!execRow.execIsActive) {
    return {
      ok: false,
      error: 'Exec account is deactivated — cannot issue new warnings',
    };
  }

  let captainName: string | null = null;
  if (execRow.captainId) {
    const [c] = await db
      .select({ name: users.fullName })
      .from(users)
      .where(eq(users.id, execRow.captainId))
      .limit(1);
    captainName = c?.name ?? null;
  }

  // Compute hard count BEFORE this insert so the message says e.g.
  // "warning 3/5" when this insert will be the 3rd active hard.
  let nextHardCount = 0;
  if (parsed.data.kind === 'hard') {
    const [c] = await db
      .select({ cnt: sql<number>`COUNT(*)::int` })
      .from(warnings)
      .where(
        and(
          eq(warnings.execUserId, parsed.data.execUserId),
          eq(warnings.kind, 'hard'),
          isNull(warnings.revokedAt),
        ),
      );
    nextHardCount = (c?.cnt ?? 0) + 1;
  }

  const periodLabelMap = Object.fromEntries(
    WARNING_PERIODS.map((p) => [p.code, p.label]),
  );
  const periodLabel =
    periodLabelMap[parsed.data.periodCode] ?? parsed.data.periodCode;

  const messageSnapshot = composeWarningMessage({
    kind: parsed.data.kind,
    execName: execRow.execName ?? 'Exec',
    captainName,
    metricCode: parsed.data.metricCode,
    periodCode: parsed.data.periodCode,
    currentValue: parsed.data.currentValue,
    targetValue: parsed.data.targetValue,
    reason: parsed.data.reason,
    hardCount: nextHardCount,
  });

  const [inserted] = await db
    .insert(warnings)
    .values({
      execUserId: parsed.data.execUserId,
      kind: parsed.data.kind,
      metricCode: parsed.data.metricCode,
      periodLabel,
      currentValue: parsed.data.currentValue,
      targetValue: parsed.data.targetValue,
      reason: parsed.data.reason,
      messageSnapshot,
      issuedByUserId: auth.userId,
    })
    .returning({ id: warnings.id });

  await logEvent({
    eventType: 'warning_issued',
    actorUserId: auth.userId,
    targetEntityType: 'warning',
    targetEntityId: inserted.id,
    beforeState: null,
    afterState: {
      execUserId: parsed.data.execUserId,
      kind: parsed.data.kind,
      metricCode: parsed.data.metricCode,
      periodCode: parsed.data.periodCode,
      currentValue: parsed.data.currentValue,
      targetValue: parsed.data.targetValue,
      reason: parsed.data.reason,
      hardCountAtIssue: nextHardCount,
    },
  });

  // Fire-and-forget notification dispatch. The engine handles errors
  // internally; we just kick it off.
  const eventType =
    parsed.data.kind === 'hard'
      ? 'exec.hard_warning_issued'
      : 'exec.soft_warning_issued';
  setImmediate(() => {
    dispatchNotification(eventType, {
      execUserId: parsed.data.execUserId,
      execName: execRow.execName ?? 'Exec',
      warningId: inserted.id,
      messageSnapshot,
      hardCount: nextHardCount,
      hardThreshold: HARD_WARNING_FIRE_THRESHOLD,
      metricCode: parsed.data.metricCode,
      captainName,
    }).catch((err) =>
      actionLog.error(
        { eventType, err: err instanceof Error ? err.message : String(err) },
        'warning_notification_dispatch_failed',
      ),
    );

    // If this hard warning just crossed the threshold, alert admin
    // (Sandeep) so he sees it in his own notifications. Separate event
    // from the exec-facing one.
    if (
      parsed.data.kind === 'hard' &&
      nextHardCount === HARD_WARNING_FIRE_THRESHOLD
    ) {
      dispatchNotification('exec.fifth_hard_warning', {
        execUserId: parsed.data.execUserId,
        execName: execRow.execName ?? 'Exec',
        warningId: inserted.id,
        hardThreshold: HARD_WARNING_FIRE_THRESHOLD,
      }).catch((err) =>
        actionLog.error(
          { err: err instanceof Error ? err.message : String(err) },
          'fifth_hard_warning_dispatch_failed',
        ),
      );
    }
  });

  revalidatePath('/', 'layout');
  return {
    ok: true,
    data: { warningId: inserted.id, messageSnapshot },
  };
}

const revokeSchema = z.object({
  warningId: z.string().uuid(),
  revokedReason: z.string().trim().min(5).max(500),
});

export async function revokeWarningAction(
  input: z.infer<typeof revokeSchema>,
): Promise<ActionResult> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = revokeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }

  const [before] = await db
    .select({
      id: warnings.id,
      execUserId: warnings.execUserId,
      kind: warnings.kind,
      revokedAt: warnings.revokedAt,
    })
    .from(warnings)
    .where(eq(warnings.id, parsed.data.warningId))
    .limit(1);

  if (!before) return { ok: false, error: 'Warning not found' };
  if (before.revokedAt) {
    return { ok: false, error: 'Warning already revoked' };
  }

  await db
    .update(warnings)
    .set({
      revokedAt: new Date(),
      revokedByUserId: auth.userId,
      revokedReason: parsed.data.revokedReason,
      updatedAt: new Date(),
    })
    .where(eq(warnings.id, parsed.data.warningId));

  await logEvent({
    eventType: 'warning_revoked',
    actorUserId: auth.userId,
    targetEntityType: 'warning',
    targetEntityId: parsed.data.warningId,
    beforeState: { revokedAt: null },
    afterState: {
      revokedByUserId: auth.userId,
      revokedReason: parsed.data.revokedReason,
    },
  });

  setImmediate(() => {
    dispatchNotification('exec.warning_revoked', {
      execUserId: before.execUserId,
      warningId: before.id,
      kind: before.kind,
      revokedReason: parsed.data.revokedReason,
    }).catch((err) =>
      actionLog.error(
        { err: err instanceof Error ? err.message : String(err) },
        'warning_revoked_dispatch_failed',
      ),
    );
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}

const deactivateSchema = z.object({
  execUserId: z.string().uuid(),
  reason: z.string().trim().min(10).max(500),
});

/**
 * Manual termination — separate action from issuing the 5th hard
 * warning. Admin must click Deactivate explicitly after seeing the
 * 5/5 banner.
 */
export async function deactivateExecAction(
  input: z.infer<typeof deactivateSchema>,
): Promise<ActionResult> {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth;

  const parsed = deactivateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }

  const [before] = await db
    .select({
      id: users.id,
      isActive: users.isActive,
      fullName: users.fullName,
    })
    .from(users)
    .where(eq(users.id, parsed.data.execUserId))
    .limit(1);

  if (!before) return { ok: false, error: 'User not found' };
  if (!before.isActive) return { ok: false, error: 'User already deactivated' };

  // Sanity: only allow this against an exec who has 5+ active hard
  // warnings. Defence in depth — UI also gates the button.
  const [c] = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(warnings)
    .where(
      and(
        eq(warnings.execUserId, parsed.data.execUserId),
        eq(warnings.kind, 'hard'),
        isNull(warnings.revokedAt),
      ),
    );
  const hardActive = c?.cnt ?? 0;
  if (hardActive < HARD_WARNING_FIRE_THRESHOLD) {
    return {
      ok: false,
      error: `Deactivate requires ${HARD_WARNING_FIRE_THRESHOLD}+ active hard warnings (currently ${hardActive})`,
    };
  }

  await db
    .update(users)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(users.id, parsed.data.execUserId));

  await logEvent({
    eventType: 'user_deactivated',
    actorUserId: auth.userId,
    targetEntityType: 'user',
    targetEntityId: parsed.data.execUserId,
    beforeState: { isActive: true },
    afterState: { isActive: false, reason: parsed.data.reason },
  });

  revalidatePath('/', 'layout');
  return { ok: true };
}
