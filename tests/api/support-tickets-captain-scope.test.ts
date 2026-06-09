import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { cities, supportTickets } from '@/db/schema';
import { loadTicketsQueue } from '@/lib/support-tickets/queue-queries';

import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-256-FIX1: captain visibility scope regression
// =============================================================================
//
// The original HVA-255 query scoped captain tickets by cities.captain_user_id
// (city captain). The right rule is team-based: captain sees tickets on
// requests where the assigned exec reports to them via
// sales_executives.captain_user_id, OR the request's assigned_captain
// = them. This test pins the new rule so it can't regress to the
// city-only behaviour.
// =============================================================================

describe('loadTicketsQueue captain scope', () => {
  it('captain sees tickets on requests where their team exec is assigned (even if city captain is someone else)', async () => {
    // Setup: Captain A has exec E1. City "Pune" has Captain B (NOT A).
    // A request lands in Pune assigned to E1. A ticket is raised.
    // Captain A should see it (team rule), Captain B should NOT
    // (it's not their team exec — even though it's their city).
    const captainA = await seedCaptain({ phone: '+919970000010' });
    const captainB = await seedCaptain({ phone: '+919970000011' });
    const city = await getOrCreateCity('Pune');
    // City captain = B (different from request team captain). This is
    // the key separation: the queue must scope by team (A's exec), not
    // by city captain (B).
    await db
      .update(cities)
      .set({ captainUserId: captainB.id })
      .where(eq(cities.id, city.id));
    const execE1 = await seedExecutive(captainA.id, {
      phone: '+919970000012',
      fullName: 'Exec on A team',
    });
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: execE1.id,
      // NB: assigned_captain on the request stays null — only exec is assigned
      statusStageCode: 'ORDER_CONFIRMED',
    });
    await db.insert(supportTickets).values({
      requestId: req.id,
      category: 'complaint',
      subject: 'Scope-test ticket',
      description: 'X',
      status: 'open',
      customerNameSnapshot: 'X',
      customerPhoneSnapshot: '+919876543210',
    });

    // Captain A (team captain) SHOULD see it
    const queueForA = await loadTicketsQueue({
      callerRole: 'captain',
      callerUserId: captainA.id,
      status: 'open',
    });
    expect(queueForA.rows).toHaveLength(1);
    expect(queueForA.rows[0].subject).toBe('Scope-test ticket');

    // Captain B (city captain only, NOT team captain) should NOT see it
    const queueForB = await loadTicketsQueue({
      callerRole: 'captain',
      callerUserId: captainB.id,
      status: 'open',
    });
    expect(queueForB.rows).toHaveLength(0);
  });

  it('captain also sees tickets on requests where they are the assigned_captain (direct route)', async () => {
    const captain = await seedCaptain({ phone: '+919970000020' });
    const city = await getOrCreateCity('Pune');
    const exec = await seedExecutive(captain.id, {
      phone: '+919970000021',
      fullName: 'Exec direct',
    });
    const req = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
      statusStageCode: 'ORDER_CONFIRMED',
    });
    await db.insert(supportTickets).values({
      requestId: req.id,
      category: 'warranty',
      subject: 'Direct-captain ticket',
      description: 'X',
      status: 'open',
      customerNameSnapshot: 'X',
      customerPhoneSnapshot: '+919876543211',
    });

    const queue = await loadTicketsQueue({
      callerRole: 'captain',
      callerUserId: captain.id,
      status: 'open',
    });
    expect(queue.rows.find((r) => r.subject === 'Direct-captain ticket')).toBeDefined();
  });
});
