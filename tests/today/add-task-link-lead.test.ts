import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addTaskAction } from '@/app/(exec)/today/actions';
import { addLeadAction } from '@/app/(exec)/leads/_actions/addLead';
import { db } from '@/db/client';
import { tasks } from '@/db/schema';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
} from '../helpers/db';
import { seedTodayDayPlan } from './helpers';

// =============================================================================
// HVA-73 follow-up: addTaskAction with linkLeadId
// =============================================================================
//
// Covers the XOR rule (request vs lead), the lead-ownership guard, the
// happy path, and the "no day plan" guard. Mirrors the same next/headers
// mock pattern as tests/today/today-loop.test.ts.
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

async function setupExecWithLeadAndPlan() {
  const captain = await seedCaptain();
  const exec = await seedExecutive(captain.id);
  const sess = await loginByPhone(exec.phone, exec.password);
  currentCookieHeader = sess.cookieHeader;
  const city = await getOrCreateCity('Bangalore');
  const plan = await seedTodayDayPlan(exec.id);

  const addLead = await addLeadAction({
    type: 'Customer',
    name: 'Alice Roy',
    phone: '9885698665',
    cityId: city.id,
    interest: ['Automation'],
    bhk: '3BHK',
  });
  if (!addLead.ok) throw new Error('seed addLead failed');
  return { captain, exec, city, plan, leadId: addLead.data!.leadId };
}

describe('HVA-73 followup: addTaskAction with linkLeadId — happy path', () => {
  it('inserts a task with link_lead_id set and link_request_id null', async () => {
    const { exec, leadId, plan } = await setupExecWithLeadAndPlan();

    const res = await addTaskAction({
      taskType: 'Follow-up',
      description: 'Call Alice tomorrow to confirm site visit',
      estimatedTime: '15min',
      linkLeadId: leadId,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [row] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, res.data!.taskId))
      .limit(1);
    expect(row.linkLeadId).toBe(leadId);
    expect(row.linkRequestId).toBeNull();
    expect(row.execUserId).toBe(exec.id);
    expect(row.dayPlanId).toBe(plan.id);
  });
});

describe('HVA-73 followup: XOR validation', () => {
  it('rejects when both linkLeadId and linkRequestId are supplied', async () => {
    const { leadId } = await setupExecWithLeadAndPlan();

    const res = await addTaskAction({
      taskType: 'Follow-up',
      description: 'Pretend a UI sent both',
      estimatedTime: '15min',
      linkLeadId: leadId,
      linkRequestId: '00000000-0000-7000-8000-000000000001',
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/request OR a lead/i);
  });
});

describe('HVA-73 followup: lead ownership guard', () => {
  it('rejects when an exec links to another exec\'s lead', async () => {
    // execA captures the lead.
    const captain = await seedCaptain();
    const execA = await seedExecutive(captain.id, {
      phone: '+919100000001',
      fullName: 'Exec A',
    });
    const execB = await seedExecutive(captain.id, {
      phone: '+919100000002',
      fullName: 'Exec B',
    });
    const city = await getOrCreateCity('Bangalore');

    const sessA = await loginByPhone(execA.phone, execA.password);
    currentCookieHeader = sessA.cookieHeader;
    const addLead = await addLeadAction({
      type: 'Customer',
      name: 'Alice',
      phone: '9885698665',
      cityId: city.id,
      interest: ['Automation'],
      bhk: '3BHK',
    });
    expect(addLead.ok).toBe(true);
    if (!addLead.ok) return;

    // execB tries to link their day-plan task to execA's lead.
    const sessB = await loginByPhone(execB.phone, execB.password);
    currentCookieHeader = sessB.cookieHeader;
    await seedTodayDayPlan(execB.id);

    const res = await addTaskAction({
      taskType: 'Follow-up',
      description: 'Trying to claim another exec lead',
      estimatedTime: '15min',
      linkLeadId: addLead.data!.leadId,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/captured by you/i);
  });
});

describe('HVA-73 followup: day-plan guard', () => {
  it('rejects when no day plan exists for today', async () => {
    const captain = await seedCaptain();
    const exec = await seedExecutive(captain.id);
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const city = await getOrCreateCity('Bangalore');

    const addLead = await addLeadAction({
      type: 'Customer',
      name: 'Alice',
      phone: '9885698665',
      cityId: city.id,
      interest: ['Automation'],
      bhk: '3BHK',
    });
    expect(addLead.ok).toBe(true);
    if (!addLead.ok) return;

    // No seedTodayDayPlan — exec hasn't started their day.
    const res = await addTaskAction({
      taskType: 'Follow-up',
      description: 'Trying without starting the day',
      estimatedTime: '15min',
      linkLeadId: addLead.data!.leadId,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/start your day/i);
  });
});
