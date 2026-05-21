import { eq, isNotNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { auditLog, dayPlans, tasks } from '@/db/schema';
import { offsetIstDate } from '@/lib/captain/dashboard-queries';
import { rollOverPendingTasks } from '@/lib/cron/roll-over-tasks';
import { getIstDateString } from '@/lib/today/time';

import { getOrCreateCity, seedCaptain, seedExecutive } from '../helpers/db';

// =============================================================================
// HVA-169: lib/cron/roll-over-tasks tests
// =============================================================================

const istToday = getIstDateString();
const yesterday = offsetIstDate(istToday, -1);
const dayBefore = offsetIstDate(istToday, -2);

async function execFixture() {
  const captain = await seedCaptain();
  await getOrCreateCity('Bangalore');
  const exec = await seedExecutive(captain.id, {
    phone: '+919200600001',
    fullName: 'Roll Exec',
  });
  return { exec };
}

async function seedTask(input: {
  execUserId: string;
  status: 'pending' | 'completed' | 'postponed';
  taskDate: string;
  rolledOverAt?: Date | null;
}) {
  const [row] = await db
    .insert(tasks)
    .values({
      execUserId: input.execUserId,
      taskType: 'Customer home visit',
      description: 'task',
      estimatedTime: '30min',
      status: input.status,
      taskDate: input.taskDate,
      rolledOverAt: input.rolledOverAt ?? null,
    })
    .returning();
  return row;
}

describe('rollOverPendingTasks', () => {
  it('stamps rolled_over_at on pending tasks with task_date < today', async () => {
    const { exec } = await execFixture();
    const t1 = await seedTask({
      execUserId: exec.id,
      status: 'pending',
      taskDate: yesterday,
    });
    const t2 = await seedTask({
      execUserId: exec.id,
      status: 'pending',
      taskDate: dayBefore,
    });
    const result = await rollOverPendingTasks();
    expect(result.rolledOver).toBe(2);
    const [r1] = await db.select().from(tasks).where(eq(tasks.id, t1.id));
    const [r2] = await db.select().from(tasks).where(eq(tasks.id, t2.id));
    expect(r1.rolledOverAt).not.toBeNull();
    expect(r2.rolledOverAt).not.toBeNull();
  });

  it("does NOT roll over today's pending tasks", async () => {
    const { exec } = await execFixture();
    const t = await seedTask({
      execUserId: exec.id,
      status: 'pending',
      taskDate: istToday,
    });
    const result = await rollOverPendingTasks();
    expect(result.rolledOver).toBe(0);
    const [row] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    expect(row.rolledOverAt).toBeNull();
  });

  it('does NOT touch completed / postponed tasks even if past-dated', async () => {
    const { exec } = await execFixture();
    const done = await seedTask({
      execUserId: exec.id,
      status: 'completed',
      taskDate: yesterday,
    });
    const post = await seedTask({
      execUserId: exec.id,
      status: 'postponed',
      taskDate: yesterday,
    });
    const result = await rollOverPendingTasks();
    expect(result.rolledOver).toBe(0);
    const [d] = await db.select().from(tasks).where(eq(tasks.id, done.id));
    const [p] = await db.select().from(tasks).where(eq(tasks.id, post.id));
    expect(d.rolledOverAt).toBeNull();
    expect(p.rolledOverAt).toBeNull();
  });

  it('idempotent — a second run does not re-stamp already-rolled-over tasks', async () => {
    const { exec } = await execFixture();
    await seedTask({
      execUserId: exec.id,
      status: 'pending',
      taskDate: yesterday,
    });
    const first = await rollOverPendingTasks();
    expect(first.rolledOver).toBe(1);
    const firstStamps = await db
      .select({ id: tasks.id, rolledOverAt: tasks.rolledOverAt })
      .from(tasks)
      .where(isNotNull(tasks.rolledOverAt));

    const second = await rollOverPendingTasks();
    expect(second.rolledOver).toBe(0);
    const secondStamps = await db
      .select({ id: tasks.id, rolledOverAt: tasks.rolledOverAt })
      .from(tasks)
      .where(isNotNull(tasks.rolledOverAt));
    // Same timestamps, untouched.
    expect(secondStamps[0].rolledOverAt?.getTime()).toBe(
      firstStamps[0].rolledOverAt?.getTime(),
    );
  });

  it('writes one audit_log row per rolled-over task with eventType=task_rolled_over', async () => {
    const { exec } = await execFixture();
    await seedTask({ execUserId: exec.id, status: 'pending', taskDate: yesterday });
    await seedTask({ execUserId: exec.id, status: 'pending', taskDate: dayBefore });
    const result = await rollOverPendingTasks();
    expect(result.rolledOver).toBe(2);
    expect(result.auditWritten).toBe(2);
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.eventType, 'task_rolled_over'));
    expect(audits).toHaveLength(2);
    expect(audits[0].actorUserId).toBeNull(); // system event
    expect(audits[0].targetEntityType).toBe('task');
  });
});

// Silence unused-helper warning.
void dayPlans;
