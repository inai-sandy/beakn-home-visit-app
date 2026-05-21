import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { cities, tasks } from '@/db/schema';
import {
  loadTeamExecStatuses,
  type DateFilter,
} from '@/lib/captain/dashboard-queries';
import { getIstDateString } from '@/lib/today/time';

import { getOrCreateCity, seedCaptain, seedExecutive } from '../helpers/db';

// =============================================================================
// HVA-169: loadTeamExecStatuses.hasRedFlag — aged rolled-over predicate
// =============================================================================

const istToday = getIstDateString();
const todayFilter: DateFilter = { mode: 'single', date: istToday };

async function captainOwningBangalore() {
  const captain = await seedCaptain();
  const city = await getOrCreateCity('Bangalore');
  await db
    .update(cities)
    .set({ captainUserId: captain.id })
    .where(eq(cities.id, city.id));
  return { captain, city };
}

async function seedRolledTask(execUserId: string, ageDays: number) {
  await db.insert(tasks).values({
    execUserId,
    taskType: 'Customer home visit',
    description: 'aged rolled over',
    estimatedTime: '30min',
    status: 'pending',
    taskDate: istToday,
    rolledOverAt: new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000),
  });
}

describe('loadTeamExecStatuses hasRedFlag — aged rolled-over predicate', () => {
  it('raises hasRedFlag when exec has a task rolled-over for > 3 days', async () => {
    const { captain } = await captainOwningBangalore();
    const exec = await seedExecutive(captain.id, {
      phone: '+919200700001',
      fullName: 'Aged',
    });
    await seedRolledTask(exec.id, 5);
    const statuses = await loadTeamExecStatuses(captain.id, todayFilter);
    const row = statuses.find((s) => s.userId === exec.id);
    expect(row?.hasRedFlag).toBe(true);
  });

  it('does NOT raise hasRedFlag when rolled-over is fresh (< 3 days)', async () => {
    const { captain } = await captainOwningBangalore();
    const exec = await seedExecutive(captain.id, {
      phone: '+919200700002',
      fullName: 'Fresh',
    });
    await seedRolledTask(exec.id, 1);
    const statuses = await loadTeamExecStatuses(captain.id, todayFilter);
    const row = statuses.find((s) => s.userId === exec.id);
    expect(row?.hasRedFlag).toBe(false);
  });

  it('raises hasRedFlag when BOTH overdue postponed AND aged rolled-over exist', async () => {
    const { captain } = await captainOwningBangalore();
    const exec = await seedExecutive(captain.id, {
      phone: '+919200700003',
      fullName: 'Both',
    });
    // overdue postponed — postponed_to_date < today
    await db.insert(tasks).values({
      execUserId: exec.id,
      taskType: 'Follow-up',
      description: 'overdue postponed',
      estimatedTime: '15min',
      status: 'postponed',
      taskDate: istToday,
      postponedToDate: '2024-01-01',
    });
    await seedRolledTask(exec.id, 5);
    const statuses = await loadTeamExecStatuses(captain.id, todayFilter);
    const row = statuses.find((s) => s.userId === exec.id);
    expect(row?.hasRedFlag).toBe(true);
    expect(row?.overdueTaskCount).toBeGreaterThan(0);
  });
});
