import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { requestStatusHistory, visitRequests } from '@/db/schema';
import {
  loadStreakForExec,
  loadStreaksForExecs,
} from '@/lib/leaderboard/streak';

import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-201 follow-up: streak tests
// =============================================================================
//
// Streak math:
//  - Count back from yesterday, NOT today (today's data is still
//    landing).
//  - A "qualifying day" is any IST day with at least one
//    VISIT_COMPLETED or ORDER_CONFIRMED transition for a request whose
//    `assigned_exec_user_id` matches the exec being measured.
//  - Streak breaks at the first missing day going backward.
//
// These tests inject history rows on specific IST days to exercise
// each branch of the consecutive-day walk.
// =============================================================================

const ANCHOR_IST_TODAY = '2026-06-05';

function istDateMinus(days: number): string {
  const [y, m, d] = ANCHOR_IST_TODAY.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Build a UTC Date that lands on the named IST date around mid-day so
 *  the timezone wrap on the SQL side resolves cleanly. 12:00 IST is
 *  06:30 UTC same day. */
function utcMidIstDay(istDateIso: string): Date {
  return new Date(`${istDateIso}T06:30:00.000Z`);
}

async function recordCompletion(
  execId: string,
  captainId: string,
  cityId: string,
  istDateIso: string,
  stageCode: 'VISIT_COMPLETED' | 'ORDER_CONFIRMED' = 'VISIT_COMPLETED',
) {
  const req = await seedVisitRequest({
    cityId,
    assignedExecUserId: execId,
    assignedCaptainUserId: captainId,
  });
  const fromStage = await getStatusStage('SUBMITTED');
  const toStage = await getStatusStage(stageCode);
  await db
    .update(visitRequests)
    .set({ statusStageId: toStage.id })
    .where(/* match by id */ (await import('drizzle-orm')).eq(
      visitRequests.id,
      req.id,
    ));
  await db.insert(requestStatusHistory).values({
    requestId: req.id,
    fromStatusStageId: fromStage.id,
    toStatusStageId: toStage.id,
    sequenceNumber: toStage.sequenceNumber,
    transitionOrder: 1,
    changedByUserId: execId,
    changedAt: utcMidIstDay(istDateIso),
  });
}

beforeEach(async () => {
  await getOrCreateCity('Bangalore');
});

describe('loadStreakForExec', () => {
  it('returns 0 when the exec has no qualifying history', async () => {
    const captain = await seedCaptain({ phone: '+919920000001' });
    const exec = await seedExecutive(captain.id, {
      phone: '+919920000002',
      fullName: 'Exec NoActivity',
    });
    const { days: streak } = await loadStreakForExec(exec.id, ANCHOR_IST_TODAY);
    expect(streak).toBe(0);
  });

  it('counts 1 when the exec had activity yesterday only', async () => {
    const captain = await seedCaptain({ phone: '+919920000010' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919920000011',
      fullName: 'Exec OneDay',
    });
    await recordCompletion(exec.id, captain.id, city.id, istDateMinus(-1));
    const { days: streak } = await loadStreakForExec(exec.id, ANCHOR_IST_TODAY);
    expect(streak).toBe(1);
  });

  it('counts consecutive days walking backward', async () => {
    const captain = await seedCaptain({ phone: '+919920000020' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919920000021',
      fullName: 'Exec FiveDays',
    });
    // Yesterday, -2, -3, -4, -5 all have activity → streak = 5.
    for (let i = 1; i <= 5; i += 1) {
      await recordCompletion(exec.id, captain.id, city.id, istDateMinus(-i));
    }
    const { days: streak } = await loadStreakForExec(exec.id, ANCHOR_IST_TODAY);
    expect(streak).toBe(5);
  });

  it('breaks at the first missing day', async () => {
    const captain = await seedCaptain({ phone: '+919920000030' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919920000031',
      fullName: 'Exec Broken',
    });
    // Yesterday + 2 days ago + (gap at -3) + 4 days ago + 5 days ago
    // → streak should be 2, not 4.
    await recordCompletion(exec.id, captain.id, city.id, istDateMinus(-1));
    await recordCompletion(exec.id, captain.id, city.id, istDateMinus(-2));
    await recordCompletion(exec.id, captain.id, city.id, istDateMinus(-4));
    await recordCompletion(exec.id, captain.id, city.id, istDateMinus(-5));
    const { days: streak } = await loadStreakForExec(exec.id, ANCHOR_IST_TODAY);
    expect(streak).toBe(2);
  });

  it('today does not count toward the streak (still in progress)', async () => {
    const captain = await seedCaptain({ phone: '+919920000040' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919920000041',
      fullName: 'Exec Today',
    });
    // Only today has activity → streak = 0 (we ignore today by design).
    await recordCompletion(exec.id, captain.id, city.id, ANCHOR_IST_TODAY);
    const { days: streak } = await loadStreakForExec(exec.id, ANCHOR_IST_TODAY);
    expect(streak).toBe(0);
  });

  it('ORDER_CONFIRMED transitions also count as activity', async () => {
    const captain = await seedCaptain({ phone: '+919920000050' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919920000051',
      fullName: 'Exec Orders',
    });
    await recordCompletion(
      exec.id,
      captain.id,
      city.id,
      istDateMinus(-1),
      'ORDER_CONFIRMED',
    );
    const { days: streak } = await loadStreakForExec(exec.id, ANCHOR_IST_TODAY);
    expect(streak).toBe(1);
  });

  it('lastActiveDay is null when the exec has zero qualifying history', async () => {
    const captain = await seedCaptain({ phone: '+919920000070' });
    const exec = await seedExecutive(captain.id, {
      phone: '+919920000071',
      fullName: 'Exec NoHistory',
    });
    const summary = await loadStreakForExec(exec.id, ANCHOR_IST_TODAY);
    expect(summary).toEqual({ days: 0, lastActiveDay: null });
  });

  it('lastActiveDay returns the most recent active day when streak is 0', async () => {
    const captain = await seedCaptain({ phone: '+919920000080' });
    const city = await getOrCreateCity('Bangalore');
    const exec = await seedExecutive(captain.id, {
      phone: '+919920000081',
      fullName: 'Exec Dormant',
    });
    // Active 10 days ago, then nothing → days = 0, lastActiveDay = the
    // 10-days-ago date.
    const targetDay = istDateMinus(-10);
    await recordCompletion(exec.id, captain.id, city.id, targetDay);
    const summary = await loadStreakForExec(exec.id, ANCHOR_IST_TODAY);
    expect(summary.days).toBe(0);
    expect(summary.lastActiveDay).toBe(targetDay);
  });
});

describe('loadStreaksForExecs', () => {
  it('returns separate streaks for each exec, attributed via assigned_exec', async () => {
    const captain = await seedCaptain({ phone: '+919920000060' });
    const city = await getOrCreateCity('Bangalore');
    const execA = await seedExecutive(captain.id, {
      phone: '+919920000061',
      fullName: 'Exec Alpha',
    });
    const execB = await seedExecutive(captain.id, {
      phone: '+919920000062',
      fullName: 'Exec Bravo',
    });

    // A: 3-day streak. B: 1-day streak.
    for (let i = 1; i <= 3; i += 1) {
      await recordCompletion(execA.id, captain.id, city.id, istDateMinus(-i));
    }
    await recordCompletion(execB.id, captain.id, city.id, istDateMinus(-1));

    const streaks = await loadStreaksForExecs(
      [execA.id, execB.id],
      ANCHOR_IST_TODAY,
    );
    expect(streaks.get(execA.id)).toBe(3);
    expect(streaks.get(execB.id)).toBe(1);
  });

  it('returns an empty map when given no exec ids', async () => {
    const streaks = await loadStreaksForExecs([], ANCHOR_IST_TODAY);
    expect(streaks.size).toBe(0);
  });
});
