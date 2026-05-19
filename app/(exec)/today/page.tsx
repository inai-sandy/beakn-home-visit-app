import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { db } from '@/db/client';
import {
  dayPlans,
  leads,
  outcomeOptions,
  postponeReasons,
  tasks,
  visitRequests,
} from '@/db/schema';
import { getServerSession } from '@/lib/auth-server';
import { getConfig } from '@/lib/config';
import { loadExecVisibleContactIds } from '@/lib/exec/visible-contacts';
import { getIstDateString, isAtOrAfterIstTime } from '@/lib/today/time';

import { PreSubmissionView } from './_components/PreSubmissionView';
import { PostSubmissionView } from './_components/PostSubmissionView';

// =============================================================================
// HVA-60: /today — daily exec loop entry point
// =============================================================================
//
// One route, three rendered states decided by the day_plans row for the
// (current exec, today IST date) pair:
//
//   row missing  → pre-submission: placeholder + "Start My Day" button
//   row present  → post-submission: NextTask + tasks list + Add Task FAB
//                   + optional Close-the-Day sticky button
//   row.closed_at set → read-only closed state (re-renders the post-submission
//                   view with mutation buttons hidden; the linked /today/close
//                   page becomes the canonical surface)
//
// proxy.ts already gates this route to sales_executive + super_admin
// (escape hatch). Defence-in-depth role check below covers any future
// proxy regression.
// =============================================================================

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Today — Beakn',
  description: 'Your daily plan.',
};

export default async function TodayPage() {
  const session = await getServerSession();
  if (!session) {
    redirect('/login?next=/today');
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
    })
    .from(dayPlans)
    .where(and(eq(dayPlans.execUserId, user.id), eq(dayPlans.planDate, istDate)))
    .limit(1);

  if (!plan) {
    return <PreSubmissionView />;
  }

  // Day already closed → redirect to the close-screen so /today is never
  // a live editing surface for a sealed day. Per HVA-60 bundle:
  // "Re-rendering /today after close shows the Close screen in read-only mode."
  if (plan.closedAt !== null) {
    redirect('/today/close');
  }

  // Day plan exists. Load tasks for today + the lookup tables the inline
  // Mark Done / Postpone flows need. Five queries here; they all hit
  // covered indexes (day_plan_idx on tasks, task_type_idx on outcome_options,
  // primary key on postpone_reasons) so the cost is trivial.
  const [taskRows, allOutcomeOptions, allPostponeReasons, dayCloseTargetTime] =
    await Promise.all([
      db
        .select({
          id: tasks.id,
          taskType: tasks.taskType,
          description: tasks.description,
          estimatedTime: tasks.estimatedTime,
          status: tasks.status,
          linkRequestId: tasks.linkRequestId,
          linkLeadId: tasks.linkLeadId,
          outcomeOptionId: tasks.outcomeOptionId,
          outcomeOptionName: outcomeOptions.name,
          outcomeNotes: tasks.outcomeNotes,
          postponedToDate: tasks.postponedToDate,
          customerInformed: tasks.customerInformed,
          createdAt: tasks.createdAt,
        })
        .from(tasks)
        .leftJoin(outcomeOptions, eq(outcomeOptions.id, tasks.outcomeOptionId))
        .where(eq(tasks.dayPlanId, plan.id))
        .orderBy(asc(tasks.createdAt)),
      db
        .select({
          id: outcomeOptions.id,
          taskType: outcomeOptions.taskType,
          code: outcomeOptions.code,
          name: outcomeOptions.name,
          sequenceNumber: outcomeOptions.sequenceNumber,
        })
        .from(outcomeOptions)
        .where(eq(outcomeOptions.isActive, true))
        .orderBy(asc(outcomeOptions.taskType), asc(outcomeOptions.sequenceNumber)),
      db
        .select({
          id: postponeReasons.id,
          code: postponeReasons.code,
          name: postponeReasons.name,
          sequenceNumber: postponeReasons.sequenceNumber,
        })
        .from(postponeReasons)
        .where(eq(postponeReasons.isActive, true))
        .orderBy(asc(postponeReasons.sequenceNumber)),
      getConfig('day_close_target_time'),
    ]);

  // Suggest linkables for the AddTaskSheet — exec's own assignments
  // (requests) + visible unconverted leads (HVA-73 PR 3: visibility
  // broadens beyond captor to any reassignment chain participant).
  const visibleContactIds = await loadExecVisibleContactIds(user.id);
  const [linkableRequests, linkableLeads] = await Promise.all([
    db
      .select({
        id: visitRequests.id,
        customerName: visitRequests.customerName,
        customerPhone: visitRequests.customerPhone,
      })
      .from(visitRequests)
      .where(eq(visitRequests.assignedExecUserId, user.id))
      .orderBy(asc(visitRequests.createdAt))
      .limit(50),
    visibleContactIds.length === 0
      ? Promise.resolve([] as Array<{ id: string; name: string; phone: string }>)
      : db
          .select({
            id: leads.id,
            name: leads.name,
            phone: leads.phone,
          })
          .from(leads)
          .where(
            and(
              inArray(leads.id, visibleContactIds),
              isNull(leads.convertedToRequestId),
            ),
          )
          .orderBy(asc(leads.createdAt))
          .limit(50),
  ]);

  const isCloseButtonVisible =
    plan.closedAt === null && isAtOrAfterIstTime(new Date(), dayCloseTargetTime);

  return (
    <PostSubmissionView
      dayPlan={{
        id: plan.id,
        submittedAt: plan.submittedAt.toISOString(),
        // After the `if (plan.closedAt !== null) redirect('/today/close')`
        // above, plan.closedAt is provably `null` — TS narrows the type
        // past `Date | null` to literal `null`. The previous
        // `plan.closedAt ? .toISOString() : null` truthy check infers
        // the truthy branch as `never` and fails `next build` (which is
        // stricter than the local `tsc --noEmit` output I was reading).
        // `instanceof Date` also fails because strict TS rejects
        // `instanceof` on a value typed as `null`. Literal `null` is
        // the only form strict-mode TS accepts here, and it's correct:
        // the only path to this line has closedAt === null.
        closedAt: null,
      }}
      tasks={taskRows.map((t) => ({
        id: t.id,
        taskType: t.taskType,
        description: t.description,
        estimatedTime: t.estimatedTime,
        status: t.status,
        linkRequestId: t.linkRequestId,
        linkLeadId: t.linkLeadId,
        outcomeOptionId: t.outcomeOptionId,
        outcomeOptionName: t.outcomeOptionName,
        outcomeNotes: t.outcomeNotes,
        postponedToDate: t.postponedToDate,
        customerInformed: t.customerInformed,
        createdAt: t.createdAt.toISOString(),
      }))}
      outcomeOptionsByType={groupOutcomeOptions(allOutcomeOptions)}
      postponeReasons={allPostponeReasons}
      linkableRequests={linkableRequests}
      linkableLeads={linkableLeads}
      isCloseButtonVisible={isCloseButtonVisible}
    />
  );
}

function groupOutcomeOptions(
  rows: Array<{
    id: string;
    taskType: string;
    code: string;
    name: string;
    sequenceNumber: number;
  }>,
): Record<string, Array<{ id: string; code: string; name: string }>> {
  const out: Record<string, Array<{ id: string; code: string; name: string }>> = {};
  for (const r of rows) {
    if (!out[r.taskType]) out[r.taskType] = [];
    out[r.taskType].push({ id: r.id, code: r.code, name: r.name });
  }
  return out;
}
