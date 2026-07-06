import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { dayPlans, tasks } from '@/db/schema';
import { loadCalendarEvents } from '@/lib/exec/calendar-queries';

import { getOrCreateCity, seedCaptain, seedExecutive } from '../helpers/db';

// =============================================================================
// Regression: the exec calendar must not render a cancelled task
// =============================================================================
//
// lib/exec/calendar-queries.ts loadCalendarEvents() used to select every
// task row for the exec in range with no status filter. Once
// cancelLinkedVisitTask() started flipping a task's status to 'cancelled'
// (reschedule/reassign/cancel task-sync), a cancelled task would still
// render as a live calendar tile — the exec would see a visit that had
// actually been called off.
//
// The fix adds `ne(tasks.status, 'cancelled')` (plus a defensive check on
// the linked request's cancelled_at) to the task query's WHERE clause.
// =============================================================================

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

describe('loadCalendarEvents excludes cancelled tasks (regression)', () => {
  it('does not include a task whose status is cancelled', async () => {
    const captain = await seedCaptain({ phone: '+919945000001' });
    await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919945000002',
      fullName: 'Exec CalendarCancelled',
    });

    const date = todayIso();
    const [plan] = await db
      .insert(dayPlans)
      .values({ execUserId: exec.id, planDate: date })
      .returning({ id: dayPlans.id });

    const [task] = await db
      .insert(tasks)
      .values({
        execUserId: exec.id,
        dayPlanId: plan!.id,
        taskType: 'Other',
        description: 'Follow up call',
        estimatedTime: '00:30',
        taskDate: date,
        status: 'cancelled',
      })
      .returning({ id: tasks.id });

    const events = await loadCalendarEvents(exec.id, date, date);
    expect(events.some((e) => e.id === task!.id)).toBe(false);
  });

  it('control: a pending task on the same day DOES appear', async () => {
    const captain = await seedCaptain({ phone: '+919945000003' });
    await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919945000004',
      fullName: 'Exec CalendarPending',
    });

    const date = todayIso();
    const [plan] = await db
      .insert(dayPlans)
      .values({ execUserId: exec.id, planDate: date })
      .returning({ id: dayPlans.id });

    const [task] = await db
      .insert(tasks)
      .values({
        execUserId: exec.id,
        dayPlanId: plan!.id,
        taskType: 'Other',
        description: 'Follow up call',
        estimatedTime: '00:30',
        taskDate: date,
        status: 'pending',
      })
      .returning({ id: tasks.id });

    const events = await loadCalendarEvents(exec.id, date, date);
    expect(events.some((e) => e.id === task!.id)).toBe(true);
  });
});
