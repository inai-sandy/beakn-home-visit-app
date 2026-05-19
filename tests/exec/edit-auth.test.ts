import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  leads,
  requestExecAssignments,
  tasks,
  visitRequests,
} from '@/db/schema';
import {
  canExecEditContact,
  canExecEditRequest,
  canExecEditTask,
} from '@/lib/exec/edit-auth';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-159: edit-auth helpers
// =============================================================================

async function seedContact(input: {
  capturedBy: string;
  cityId: string;
  name?: string;
}) {
  const [row] = await db
    .insert(leads)
    .values({
      type: 'Customer',
      name: input.name ?? 'Test',
      phone: `+9198${Math.floor(Math.random() * 1e8)
        .toString()
        .padStart(8, '0')}`,
      cityId: input.cityId,
      interest: [],
      capturedByUserId: input.capturedBy,
    })
    .returning({ id: leads.id });
  return row.id;
}

async function seedTaskRow(input: {
  execUserId: string;
  status: 'pending' | 'completed' | 'cancelled' | 'postponed';
}) {
  // dayPlan is nullable; for auth-only tests we don't need a plan id.
  const [row] = await db
    .insert(tasks)
    .values({
      execUserId: input.execUserId,
      taskType: 'Follow-up',
      description: 'Auth test task description.',
      estimatedTime: '30min',
      taskDate: '2026-05-19',
      status: input.status,
    })
    .returning({ id: tasks.id });
  return row.id;
}

describe('canExecEditContact', () => {
  it('returns true when the actor captured the contact', async () => {
    const cap = await seedCaptain({
      phone: '+919000110001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919100110001',
      fullName: 'Exec',
    });
    const city = await getOrCreateCity('Bangalore');
    const id = await seedContact({ capturedBy: exec.id, cityId: city.id });
    expect(await canExecEditContact(exec.id, id)).toBe(true);
  });

  it('returns false for an unrelated exec', async () => {
    const cap = await seedCaptain({
      phone: '+919000120001',
      fullName: 'Cap',
    });
    const execA = await seedExecutive(cap.id, {
      phone: '+919100120001',
      fullName: 'Exec A',
    });
    const execB = await seedExecutive(cap.id, {
      phone: '+919100120002',
      fullName: 'Exec B',
    });
    const city = await getOrCreateCity('Bangalore');
    const id = await seedContact({ capturedBy: execA.id, cityId: city.id });
    expect(await canExecEditContact(execB.id, id)).toBe(false);
  });

  it('returns true via reassignment trail (delegates to visible-contacts)', async () => {
    const cap = await seedCaptain({
      phone: '+919000130001',
      fullName: 'Cap',
    });
    const execA = await seedExecutive(cap.id, {
      phone: '+919100130001',
      fullName: 'Exec A',
    });
    const execB = await seedExecutive(cap.id, {
      phone: '+919100130002',
      fullName: 'Exec B',
    });
    const city = await getOrCreateCity('Bangalore');
    const contactId = await seedContact({
      capturedBy: execA.id,
      cityId: city.id,
    });
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: execB.id,
      statusStageCode: 'ASSIGNED',
    });
    await db
      .update(visitRequests)
      .set({ contactId })
      .where(eq(visitRequests.id, req.id));

    // execB can edit even though they didn't capture — they hold the request.
    expect(await canExecEditContact(execB.id, contactId)).toBe(true);
  });
});

describe('canExecEditRequest — strict 2-rule D2', () => {
  it('current assignee can edit', async () => {
    const cap = await seedCaptain({
      phone: '+919000140001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919100140001',
      fullName: 'Exec',
    });
    const city = await getOrCreateCity('Bangalore');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'ASSIGNED',
    });
    expect(await canExecEditRequest(exec.id, req.id)).toBe(true);
  });

  it('to-exec on a reassignment row can edit', async () => {
    const cap = await seedCaptain({
      phone: '+919000150001',
      fullName: 'Cap',
    });
    const execA = await seedExecutive(cap.id, {
      phone: '+919100150001',
      fullName: 'Exec A',
    });
    const execB = await seedExecutive(cap.id, {
      phone: '+919100150002',
      fullName: 'Exec B',
    });
    const city = await getOrCreateCity('Bangalore');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: execB.id,
      statusStageCode: 'ASSIGNED',
    });
    // Seed a reassignment from A → B. reason has a CHECK 50–500.
    const longEnough = 'Reassignment row created for the edit-auth test.';
    await db.insert(requestExecAssignments).values({
      requestId: req.id,
      fromExecUserId: execA.id,
      toExecUserId: execB.id,
      captainUserId: cap.id,
      reason: `A → B (${longEnough}) — covering the auth path.`,
    });
    expect(await canExecEditRequest(execB.id, req.id)).toBe(true);
  });

  it('original-assignee-reassigned-away CANNOT edit (D2 strict)', async () => {
    const cap = await seedCaptain({
      phone: '+919000160001',
      fullName: 'Cap',
    });
    const execA = await seedExecutive(cap.id, {
      phone: '+919100160001',
      fullName: 'Exec A',
    });
    const execB = await seedExecutive(cap.id, {
      phone: '+919100160002',
      fullName: 'Exec B',
    });
    const city = await getOrCreateCity('Bangalore');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: execB.id, // already at B (reassigned)
      statusStageCode: 'ASSIGNED',
    });
    const longEnough = 'Reassignment row created for the edit-auth test.';
    await db.insert(requestExecAssignments).values({
      requestId: req.id,
      fromExecUserId: execA.id,
      toExecUserId: execB.id,
      captainUserId: cap.id,
      reason: `A → B (${longEnough}) — strict 2-rule check.`,
    });
    // A never appears as a to-exec; current assignee is B. Strict D2 → A blocked.
    expect(await canExecEditRequest(execA.id, req.id)).toBe(false);
  });

  it('unrelated exec cannot edit', async () => {
    const cap = await seedCaptain({
      phone: '+919000170001',
      fullName: 'Cap',
    });
    const execX = await seedExecutive(cap.id, {
      phone: '+919100170001',
      fullName: 'Exec X',
    });
    const execY = await seedExecutive(cap.id, {
      phone: '+919100170002',
      fullName: 'Exec Y',
    });
    const city = await getOrCreateCity('Bangalore');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: execX.id,
      statusStageCode: 'ASSIGNED',
    });
    expect(await canExecEditRequest(execY.id, req.id)).toBe(false);
  });
});

describe('canExecEditTask', () => {
  it('returns true for the owner of a pending task', async () => {
    const cap = await seedCaptain({
      phone: '+919000180001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919100180001',
      fullName: 'Exec',
    });
    const taskId = await seedTaskRow({ execUserId: exec.id, status: 'pending' });
    expect(await canExecEditTask(exec.id, taskId)).toBe(true);
  });

  it('returns true for the owner of a postponed task', async () => {
    const cap = await seedCaptain({
      phone: '+919000190001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919100190001',
      fullName: 'Exec',
    });
    const taskId = await seedTaskRow({
      execUserId: exec.id,
      status: 'postponed',
    });
    expect(await canExecEditTask(exec.id, taskId)).toBe(true);
  });

  it('returns false for a completed task (locked)', async () => {
    const cap = await seedCaptain({
      phone: '+919000200001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919100200001',
      fullName: 'Exec',
    });
    const taskId = await seedTaskRow({
      execUserId: exec.id,
      status: 'completed',
    });
    expect(await canExecEditTask(exec.id, taskId)).toBe(false);
  });

  it('returns false for a cancelled task (locked)', async () => {
    const cap = await seedCaptain({
      phone: '+919000210001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919100210001',
      fullName: 'Exec',
    });
    const taskId = await seedTaskRow({
      execUserId: exec.id,
      status: 'cancelled',
    });
    expect(await canExecEditTask(exec.id, taskId)).toBe(false);
  });

  it('returns false for a non-owner exec', async () => {
    const cap = await seedCaptain({
      phone: '+919000220001',
      fullName: 'Cap',
    });
    const owner = await seedExecutive(cap.id, {
      phone: '+919100220001',
      fullName: 'Owner',
    });
    const other = await seedExecutive(cap.id, {
      phone: '+919100220002',
      fullName: 'Other',
    });
    const taskId = await seedTaskRow({
      execUserId: owner.id,
      status: 'pending',
    });
    expect(await canExecEditTask(other.id, taskId)).toBe(false);
  });
});
