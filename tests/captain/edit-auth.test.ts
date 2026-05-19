import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { leads, users, visitRequests } from '@/db/schema';
import {
  canCaptainEditContact,
  canCaptainEditRequest,
} from '@/lib/captain/edit-auth';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-163: captain edit-auth tests
// =============================================================================
//
// Two helpers, four scope buckets per:
//   contact: in-team / out-of-team / inactive-captor / missing
//   request: assigned-captain me / assigned-exec on team / neither / missing
// Plus null-tolerance smoke checks.
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

describe('canCaptainEditContact', () => {
  it('returns true when the contact captor is on the captain\'s team', async () => {
    const cap = await seedCaptain({
      phone: '+919000800001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919100800001',
      fullName: 'Exec',
    });
    const city = await getOrCreateCity('Bangalore');
    const id = await seedContact({ capturedBy: exec.id, cityId: city.id });
    expect(await canCaptainEditContact(cap.id, id)).toBe(true);
  });

  it('returns false when the captor sits on another captain\'s team', async () => {
    const capA = await seedCaptain({
      phone: '+919000810001',
      fullName: 'Cap A',
    });
    const capB = await seedCaptain({
      phone: '+919000810002',
      fullName: 'Cap B',
    });
    const execA = await seedExecutive(capA.id, {
      phone: '+919100810001',
      fullName: 'Exec A',
    });
    const city = await getOrCreateCity('Bangalore');
    const id = await seedContact({ capturedBy: execA.id, cityId: city.id });
    expect(await canCaptainEditContact(capB.id, id)).toBe(false);
  });

  it('returns false when the captor user has been deactivated', async () => {
    const cap = await seedCaptain({
      phone: '+919000820001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919100820001',
      fullName: 'Exec',
    });
    const city = await getOrCreateCity('Bangalore');
    const id = await seedContact({ capturedBy: exec.id, cityId: city.id });
    // Deactivate the captor — loadCaptainTeamUserIds filters by
    // users.is_active so they fall out of the team set.
    await db
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, exec.id));
    expect(await canCaptainEditContact(cap.id, id)).toBe(false);
  });

  it('returns false for a contact that doesn\'t exist', async () => {
    const cap = await seedCaptain({
      phone: '+919000830001',
      fullName: 'Cap',
    });
    expect(
      await canCaptainEditContact(
        cap.id,
        '00000000-0000-7000-8000-000000000000',
      ),
    ).toBe(false);
  });
});

describe('canCaptainEditRequest', () => {
  it('returns true when the request is routed to me (assigned_captain_user_id = me)', async () => {
    const cap = await seedCaptain({
      phone: '+919000840001',
      fullName: 'Cap',
    });
    const city = await getOrCreateCity('Bangalore');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedCaptainUserId: cap.id,
      // assignedExecUserId omitted → request is captain-routed but
      // exec-less. Rule (1) should still pass.
      statusStageCode: 'SUBMITTED',
    });
    expect(await canCaptainEditRequest(cap.id, req.id)).toBe(true);
  });

  it('returns true when the assigned exec is on my team (even if assigned_captain differs)', async () => {
    const capA = await seedCaptain({
      phone: '+919000850001',
      fullName: 'Cap A',
    });
    const capB = await seedCaptain({
      phone: '+919000850002',
      fullName: 'Cap B',
    });
    const execA = await seedExecutive(capA.id, {
      phone: '+919100850001',
      fullName: 'Exec A',
    });
    const city = await getOrCreateCity('Bangalore');
    // assigned_captain = capB (the city's captain in this fixture), but
    // the exec is on capA's team.
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: execA.id,
      assignedCaptainUserId: capB.id,
      statusStageCode: 'ASSIGNED',
    });
    expect(await canCaptainEditRequest(capA.id, req.id)).toBe(true);
  });

  it('returns false when neither rule matches', async () => {
    const capA = await seedCaptain({
      phone: '+919000860001',
      fullName: 'Cap A',
    });
    const capB = await seedCaptain({
      phone: '+919000860002',
      fullName: 'Cap B',
    });
    const execB = await seedExecutive(capB.id, {
      phone: '+919100860001',
      fullName: 'Exec B',
    });
    const city = await getOrCreateCity('Bangalore');
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: execB.id,
      assignedCaptainUserId: capB.id,
      statusStageCode: 'ASSIGNED',
    });
    expect(await canCaptainEditRequest(capA.id, req.id)).toBe(false);
  });

  it('returns false for a missing request id', async () => {
    const cap = await seedCaptain({
      phone: '+919000870001',
      fullName: 'Cap',
    });
    expect(
      await canCaptainEditRequest(
        cap.id,
        '00000000-0000-7000-8000-000000000000',
      ),
    ).toBe(false);
  });

  it('handles null assigned_exec gracefully (rule 2 falls through, rule 1 decides)', async () => {
    const capA = await seedCaptain({
      phone: '+919000880001',
      fullName: 'Cap A',
    });
    const capB = await seedCaptain({
      phone: '+919000880002',
      fullName: 'Cap B',
    });
    const city = await getOrCreateCity('Bangalore');
    // Unassigned request routed to capA. capB should NOT be allowed.
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedCaptainUserId: capA.id,
      statusStageCode: 'SUBMITTED',
    });
    expect(await canCaptainEditRequest(capA.id, req.id)).toBe(true);
    expect(await canCaptainEditRequest(capB.id, req.id)).toBe(false);
  });

  it('handles null assigned_captain gracefully (rule 1 falls through, rule 2 decides)', async () => {
    const cap = await seedCaptain({
      phone: '+919000890001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919100890001',
      fullName: 'Exec',
    });
    const city = await getOrCreateCity('Bangalore');
    // assigned_captain not set; the test helper seeds it as null when
    // assignedCaptainUserId is omitted from input.
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      statusStageCode: 'ASSIGNED',
    });
    // Sanity that captain column is null in the fixture.
    const [vr] = await db
      .select({ assignedCaptainUserId: visitRequests.assignedCaptainUserId })
      .from(visitRequests)
      .where(eq(visitRequests.id, req.id))
      .limit(1);
    expect(vr.assignedCaptainUserId).toBeNull();
    expect(await canCaptainEditRequest(cap.id, req.id)).toBe(true);
  });
});
