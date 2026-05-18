import { and, eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import { dayPlans } from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { loadDayCloseMetrics } from '@/lib/today/metrics';
import { getIstDateString } from '@/lib/today/time';

import { CloseDayView } from './_components/CloseDayView';

// =============================================================================
// HVA-64: /today/close — Close the Day metric summary + close action
// =============================================================================
//
// Server component. Loads today's day_plan, runs every metric query in
// parallel, hands the result tree to a client wrapper that owns the
// confirmation modal + close action.
//
// Pre-conditions:
//   * Day plan must exist for (current exec, today IST). If missing, redirect to /today.
//   * Render works whether the plan is open OR already closed. Closed
//     state hides the Close button + confirmation modal and renders the
//     summary as a record.
//
// Role gate: same as /today (sales_executive | super_admin). proxy.ts
// already gates /today/*; explicit redirect-on-missing-row keeps the
// page tolerant of a manual URL hit.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Close the Day — Beakn',
};

export default async function CloseTheDayPage() {
  const session = await getServerSession();
  if (!session) {
    redirect('/login?next=/today/close');
  }
  const user = session.user as { id: string; role?: string };
  if (user.role !== 'sales_executive' && user.role !== 'super_admin') {
    redirect('/login');
  }

  const istDate = getIstDateString();
  const [plan] = await db
    .select({
      id: dayPlans.id,
      submittedAt: dayPlans.submittedAt,
      closedAt: dayPlans.closedAt,
      planDate: dayPlans.planDate,
    })
    .from(dayPlans)
    .where(and(eq(dayPlans.execUserId, user.id), eq(dayPlans.planDate, istDate)))
    .limit(1);
  if (!plan) {
    redirect('/today');
  }

  const metrics = await loadDayCloseMetrics({
    execUserId: user.id,
    dayPlanId: plan.id,
    dayPlanSubmittedAt: plan.submittedAt,
    istDateStr: istDate,
  });

  return (
    <CloseDayView
      dayPlan={{
        id: plan.id,
        closedAt: plan.closedAt ? plan.closedAt.toISOString() : null,
      }}
      metrics={metrics}
    />
  );
}
