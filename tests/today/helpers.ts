import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { dayPlans, postponeReasons, tasks } from '@/db/schema';
import { getIstDateString } from '@/lib/today/time';

// =============================================================================
// HVA-60 test fixtures: day_plans + tasks seeders
// =============================================================================

export async function seedTodayDayPlan(execUserId: string, args?: {
  closedAt?: Date | null;
}): Promise<{ id: string; submittedAt: Date; planDate: string }> {
  const planDate = getIstDateString();
  // Idempotent: use ON CONFLICT … DO NOTHING via the unique (exec, date) index,
  // then SELECT to grab the existing row when one's already there.
  await db
    .insert(dayPlans)
    .values({ execUserId, planDate, closedAt: args?.closedAt ?? null })
    .onConflictDoNothing();
  const [row] = await db
    .select({
      id: dayPlans.id,
      submittedAt: dayPlans.submittedAt,
      planDate: dayPlans.planDate,
      closedAt: dayPlans.closedAt,
    })
    .from(dayPlans)
    .where(eq(dayPlans.execUserId, execUserId))
    .limit(1);
  if (args?.closedAt !== undefined && row.closedAt === null) {
    await db.update(dayPlans).set({ closedAt: args.closedAt }).where(eq(dayPlans.id, row.id));
  }
  return { id: row.id, submittedAt: row.submittedAt, planDate: row.planDate };
}

export async function seedTask(args: {
  execUserId: string;
  dayPlanId: string;
  taskType: string;
  description?: string;
  estimatedTime?: string;
  status?: 'pending' | 'completed' | 'postponed';
}): Promise<{ id: string }> {
  const planDate = getIstDateString();
  const [row] = await db
    .insert(tasks)
    .values({
      execUserId: args.execUserId,
      dayPlanId: args.dayPlanId,
      taskType: args.taskType as never,
      description: args.description ?? 'A representative task description.',
      estimatedTime: args.estimatedTime ?? '30min',
      taskDate: planDate,
      status: args.status ?? 'pending',
    })
    .returning({ id: tasks.id });
  return { id: row.id };
}

export async function getFirstPostponeReason(): Promise<{ id: string; code: string }> {
  const [r] = await db
    .select({ id: postponeReasons.id, code: postponeReasons.code })
    .from(postponeReasons)
    .limit(1);
  return r;
}
