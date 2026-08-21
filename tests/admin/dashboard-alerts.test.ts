import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  adminHelpMessages,
  requestStatusHistory,
  visitRequests,
} from '@/db/schema';
import { loadAdminAlerts } from '@/lib/admin/dashboard-queries';
import {
  rawTimestampToDate,
  rawTimestampToDateOrNull,
} from '@/lib/db/raw-timestamp';

import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-346: the admin alert feed must survive being sorted
// =============================================================================
//
// `/admin/dashboard` threw `TypeError: a.at.getTime is not a function` for
// every super_admin, and because login redirects there it read as "I cannot
// log in". The aging-approval timestamp came from a raw `sql` subquery typed
// `sql<Date>` — an assertion, not a conversion — so it was really a string.
//
// THE FIXTURE MUST PRODUCE TWO ALERTS. `Array.prototype.sort` does not invoke
// its comparator on a single-element array, which is why the bug sat latent
// for two months and only detonated when a second alert appeared. A one-alert
// fixture passes against the broken code and would pin nothing.
// =============================================================================

const DAY_MS = 24 * 60 * 60 * 1000;

async function seedAgingApproval(opts: {
  cityId: string;
  execId: string;
  captainId: string;
  daysAgo: number;
}): Promise<string> {
  const pending = await getStatusStage('PENDING_CAPTAIN_APPROVAL');
  const submitted = await getStatusStage('SUBMITTED');

  const req = await seedVisitRequest({
    cityId: opts.cityId,
    assignedExecUserId: opts.execId,
    assignedCaptainUserId: opts.captainId,
    statusStageCode: 'PENDING_CAPTAIN_APPROVAL',
  });

  // The query reads the most recent entry INTO the pending stage from the
  // history, not the request's own timestamps, so the history row is what
  // makes it "aging".
  await db.insert(requestStatusHistory).values({
    requestId: req.id,
    fromStatusStageId: submitted.id,
    toStatusStageId: pending.id,
    sequenceNumber: pending.sequenceNumber,
    transitionOrder: 1,
    changedByUserId: opts.execId,
    changedAt: new Date(Date.now() - opts.daysAgo * DAY_MS),
  });

  return req.id;
}

describe('rawTimestampToDate', () => {
  it('converts the string a raw sql selection actually returns', () => {
    const d = rawTimestampToDate('2026-08-03 10:31:44.543464+00');
    expect(d).toBeInstanceOf(Date);
    expect(Number.isNaN(d.getTime())).toBe(false);
  });

  it('passes a real Date straight through', () => {
    const now = new Date();
    expect(rawTimestampToDate(now)).toBe(now);
  });

  it('throws rather than handing back an Invalid Date', () => {
    // An Invalid Date propagates silently — NaN comparisons, meaningless
    // sorts, "Invalid Date" rendered to a user. Failing here names the fault
    // where it happened.
    expect(() => rawTimestampToDate('not a timestamp')).toThrow(TypeError);
  });

  it('allows null only through the explicit nullable variant', () => {
    expect(rawTimestampToDateOrNull(null)).toBeNull();
    expect(rawTimestampToDateOrNull(undefined)).toBeNull();
    expect(rawTimestampToDateOrNull('2026-08-03T10:31:44Z')).toBeInstanceOf(
      Date,
    );
  });
});

describe('loadAdminAlerts', () => {
  it('sorts a feed containing an aging approval without throwing', async () => {
    const city = await getOrCreateCity('Bangalore');
    const captain = await seedCaptain({ phone: '+919000346001' });
    const exec = await seedExecutive(captain.id, { phone: '+919100346001' });

    const agingId = await seedAgingApproval({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      daysAgo: 18,
    });

    // The SECOND alert. Without it the comparator never runs and this test
    // would pass against the exact code that took production down.
    const helpReq = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
    });
    await db.insert(adminHelpMessages).values({
      requestId: helpReq.id,
      execUserId: exec.id,
      message: 'Customer is asking about the installation date.',
    });

    const alerts = await loadAdminAlerts();

    expect(alerts.length).toBeGreaterThanOrEqual(2);
    expect(alerts.some((a) => a.kind === 'aging_approval')).toBe(true);
    expect(alerts.some((a) => a.kind === 'admin_help')).toBe(true);

    // Every `at` must be a real Date — this is the assertion the string
    // failed. `instanceof` and not merely "truthy": a string is truthy.
    for (const alert of alerts) {
      expect(alert.at).toBeInstanceOf(Date);
      expect(Number.isNaN(alert.at.getTime())).toBe(false);
    }

    // And the sort has to have actually happened: newest first.
    const times = alerts.map((a) => a.at.getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);

    // The 18-day-old approval is the oldest, so it sorts last.
    expect(alerts[alerts.length - 1].id).toBe(agingId);
  });

  it('leaves an approval younger than the ageing threshold out', async () => {
    const city = await getOrCreateCity('Bangalore');
    const captain = await seedCaptain({ phone: '+919000346002' });
    const exec = await seedExecutive(captain.id, { phone: '+919100346002' });

    const freshId = await seedAgingApproval({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      daysAgo: 0,
    });

    const alerts = await loadAdminAlerts();
    expect(alerts.map((a) => a.id)).not.toContain(freshId);
  });

  it('is empty, not broken, when there is nothing to report', async () => {
    // The empty feed is the state the dashboard spent two months in without
    // anyone noticing the bug, so it is worth pinning that it stays quiet.
    const alerts = await loadAdminAlerts();
    expect(alerts).toEqual([]);
  });
});

describe('the aging-approval row the crash came from', () => {
  it('is still reachable after the request is cancelled — and excluded', async () => {
    const city = await getOrCreateCity('Bangalore');
    const captain = await seedCaptain({ phone: '+919000346003' });
    const exec = await seedExecutive(captain.id, { phone: '+919100346003' });

    const id = await seedAgingApproval({
      cityId: city.id,
      execId: exec.id,
      captainId: captain.id,
      daysAgo: 5,
    });
    await db
      .update(visitRequests)
      .set({ cancelledAt: new Date() })
      .where(eq(visitRequests.id, id));

    const alerts = await loadAdminAlerts();
    expect(alerts.map((a) => a.id)).not.toContain(id);
  });
});
