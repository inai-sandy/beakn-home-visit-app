import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { leads } from '@/db/schema';
import {
  fetchTeamContactById,
  fetchTeamContacts,
  loadCaptainTeamUserIds,
} from '@/lib/captain/contacts-queries';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
} from '../helpers/db';

// =============================================================================
// HVA-73 PR 2: captain-scoped reads
// =============================================================================
//
// fetchTeamContacts / fetchTeamContactById must surface ONLY leads
// captured by an exec on the captain's team. Contacts captured by other
// teams' execs are invisible (D6).
// =============================================================================

async function seedLeadFor(execUserId: string, cityId: string, name: string) {
  const [row] = await db
    .insert(leads)
    .values({
      type: 'Customer',
      name,
      phone: `+9198${Math.floor(Math.random() * 1e8)
        .toString()
        .padStart(8, '0')}`,
      cityId,
      interest: ['Automation'],
      capturedByUserId: execUserId,
    })
    .returning({ id: leads.id });
  return row.id;
}

describe('loadCaptainTeamUserIds', () => {
  it('returns only the captain\'s own team execs', async () => {
    const capA = await seedCaptain({
      phone: '+919000010001',
      fullName: 'Cap A',
    });
    const capB = await seedCaptain({
      phone: '+919000010002',
      fullName: 'Cap B',
    });
    const execA1 = await seedExecutive(capA.id, {
      phone: '+919100010001',
      fullName: 'Exec A1',
    });
    const execA2 = await seedExecutive(capA.id, {
      phone: '+919100010002',
      fullName: 'Exec A2',
    });
    const execB1 = await seedExecutive(capB.id, {
      phone: '+919100010003',
      fullName: 'Exec B1',
    });

    const teamA = await loadCaptainTeamUserIds(capA.id);
    expect(teamA.sort()).toEqual([execA1.id, execA2.id].sort());

    const teamB = await loadCaptainTeamUserIds(capB.id);
    expect(teamB).toEqual([execB1.id]);
  });
});

describe('fetchTeamContacts — captain scope', () => {
  it('returns only leads captured by execs on the captain\'s team', async () => {
    const capA = await seedCaptain({
      phone: '+919000020001',
      fullName: 'Cap A',
    });
    const capB = await seedCaptain({
      phone: '+919000020002',
      fullName: 'Cap B',
    });
    const execA = await seedExecutive(capA.id, {
      phone: '+919100020001',
      fullName: 'Exec A',
    });
    const execB = await seedExecutive(capB.id, {
      phone: '+919100020002',
      fullName: 'Exec B',
    });
    const city = await getOrCreateCity('Bangalore');

    await seedLeadFor(execA.id, city.id, 'Alice (Cap A team)');
    await seedLeadFor(execB.id, city.id, 'Bob (Cap B team)');

    const teamA = await loadCaptainTeamUserIds(capA.id);
    const visibleToCapA = await fetchTeamContacts({ teamUserIds: teamA });
    expect(visibleToCapA.rows.map((r) => r.name).sort()).toEqual([
      'Alice (Cap A team)',
    ]);

    const teamB = await loadCaptainTeamUserIds(capB.id);
    const visibleToCapB = await fetchTeamContacts({ teamUserIds: teamB });
    expect(visibleToCapB.rows.map((r) => r.name).sort()).toEqual([
      'Bob (Cap B team)',
    ]);
  });

  it('returns empty when team is empty', async () => {
    const res = await fetchTeamContacts({ teamUserIds: [] });
    expect(res.rows).toEqual([]);
    expect(res.total).toBe(0);
  });
});

describe('fetchTeamContactById — 404 across teams', () => {
  it('returns the contact for a captain whose team captured it', async () => {
    const cap = await seedCaptain({
      phone: '+919000030001',
      fullName: 'Cap',
    });
    const exec = await seedExecutive(cap.id, {
      phone: '+919100030001',
      fullName: 'Exec',
    });
    const city = await getOrCreateCity('Bangalore');
    const leadId = await seedLeadFor(exec.id, city.id, 'In-team contact');

    const team = await loadCaptainTeamUserIds(cap.id);
    const got = await fetchTeamContactById(leadId, team);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(leadId);
    expect(got!.capturedByUserId).toBe(exec.id);
  });

  it('returns null when the contact belongs to a different team', async () => {
    const capA = await seedCaptain({
      phone: '+919000040001',
      fullName: 'Cap A',
    });
    const capB = await seedCaptain({
      phone: '+919000040002',
      fullName: 'Cap B',
    });
    const execA = await seedExecutive(capA.id, {
      phone: '+919100040001',
      fullName: 'Exec A',
    });
    const execB = await seedExecutive(capB.id, {
      phone: '+919100040002',
      fullName: 'Exec B',
    });
    const city = await getOrCreateCity('Bangalore');
    const otherTeamLeadId = await seedLeadFor(
      execB.id,
      city.id,
      'Cap-B captured contact',
    );
    void execA;

    const teamA = await loadCaptainTeamUserIds(capA.id);
    const got = await fetchTeamContactById(otherTeamLeadId, teamA);
    expect(got).toBeNull();

    // Confirm the lead still exists in the DB — we just don't return it.
    const [stillThere] = await db
      .select()
      .from(leads)
      .where(eq(leads.id, otherTeamLeadId))
      .limit(1);
    expect(stillThere).toBeTruthy();
  });
});
