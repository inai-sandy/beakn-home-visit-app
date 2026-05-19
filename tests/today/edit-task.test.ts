import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addTaskAction, editTaskAction } from '@/app/(exec)/today/actions';
import { db } from '@/db/client';
import { auditLog, tasks } from '@/db/schema';
import { getIstDateString } from '@/lib/today/time';

import { loginByPhone } from '../helpers/auth';
import {
  seedCaptain,
  seedExecutive,
} from '../helpers/db';
import { seedTodayDayPlan } from './helpers';

// =============================================================================
// HVA-159: editTaskAction tests
// =============================================================================

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

beforeEach(() => {
  currentCookieHeader = undefined;
});

function ymdAddDays(istDate: string, delta: number): string {
  const [y, m, d] = istDate.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + delta);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

async function setupExecWithPendingTask() {
  const cap = await seedCaptain();
  const exec = await seedExecutive(cap.id);
  const sess = await loginByPhone(exec.phone, exec.password);
  currentCookieHeader = sess.cookieHeader;
  await seedTodayDayPlan(exec.id);
  const add = await addTaskAction({
    taskType: 'Follow-up',
    description: 'A task to be edited later',
    estimatedTime: '30min',
  });
  if (!add.ok) throw new Error('seed addTask failed');
  return { exec, taskId: add.data!.taskId };
}

describe('editTaskAction — auth', () => {
  it('owner of a pending task can edit', async () => {
    const { taskId } = await setupExecWithPendingTask();
    const res = await editTaskAction({
      taskId,
      description: 'Edited description for the task row',
      taskDate: getIstDateString(),
      estimatedTime: '15min',
    });
    expect(res.ok).toBe(true);
  });

  it('non-owner exec is rejected', async () => {
    const cap = await seedCaptain();
    const owner = await seedExecutive(cap.id, {
      phone: '+919100500001',
      fullName: 'Owner',
    });
    const other = await seedExecutive(cap.id, {
      phone: '+919100500002',
      fullName: 'Other',
    });
    const sess = await loginByPhone(owner.phone, owner.password);
    currentCookieHeader = sess.cookieHeader;
    await seedTodayDayPlan(owner.id);
    const add = await addTaskAction({
      taskType: 'Follow-up',
      description: 'Owner created this',
      estimatedTime: '30min',
    });
    expect(add.ok).toBe(true);
    if (!add.ok) return;

    const otherSess = await loginByPhone(other.phone, other.password);
    currentCookieHeader = otherSess.cookieHeader;
    const res = await editTaskAction({
      taskId: add.data!.taskId,
      description: 'Stranger trying to edit',
      taskDate: getIstDateString(),
      estimatedTime: '15min',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not editable by you/i);
  });
});

describe('editTaskAction — happy path + audit', () => {
  it('updates editable fields and writes task_edited with sparse diff', async () => {
    const { taskId } = await setupExecWithPendingTask();
    const res = await editTaskAction({
      taskId,
      description: 'Edited task description text',
      taskDate: getIstDateString(),
      estimatedTime: '1hr',
    });
    expect(res.ok).toBe(true);

    const [row] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    expect(row.description).toBe('Edited task description text');
    expect(row.estimatedTime).toBe('1hr');

    const audits = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventType, 'task_edited'),
          eq(auditLog.targetEntityId, taskId),
        ),
      );
    expect(audits.length).toBe(1);
    const after = audits[0].afterState as Record<string, unknown>;
    expect(after).toHaveProperty('description', 'Edited task description text');
    expect(after).toHaveProperty('estimatedTime', '1hr');
  });
});

describe('editTaskAction — future-date auto-creates day plan', () => {
  it('moves a task to a future date and auto-creates the matching day plan', async () => {
    const { exec, taskId } = await setupExecWithPendingTask();
    const tomorrow = ymdAddDays(getIstDateString(), 1);

    const res = await editTaskAction({
      taskId,
      description: 'Pushed to tomorrow',
      taskDate: tomorrow,
      estimatedTime: '30min',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [row] = await db
      .select({ taskDate: tasks.taskDate, dayPlanId: tasks.dayPlanId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    expect(row.taskDate).toBe(tomorrow);
    expect(row.dayPlanId).not.toBeNull();
    void exec;
  });
});

describe('editTaskAction — completed task is locked', () => {
  it('rejects when the task status is completed', async () => {
    const { taskId } = await setupExecWithPendingTask();
    await db
      .update(tasks)
      .set({ status: 'completed' })
      .where(eq(tasks.id, taskId));

    const res = await editTaskAction({
      taskId,
      description: 'Should be blocked',
      taskDate: getIstDateString(),
      estimatedTime: '15min',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not editable by you/i);
  });
});

describe('editTaskAction — XOR linkRequestId / linkLeadId', () => {
  it('refuses when both link columns are set', async () => {
    const { taskId } = await setupExecWithPendingTask();
    const res = await editTaskAction({
      taskId,
      description: 'XOR violation attempt',
      taskDate: getIstDateString(),
      estimatedTime: '30min',
      linkRequestId: '00000000-0000-7000-8000-000000000010',
      linkLeadId: '00000000-0000-7000-8000-000000000011',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/request OR a lead/i);
  });
});
