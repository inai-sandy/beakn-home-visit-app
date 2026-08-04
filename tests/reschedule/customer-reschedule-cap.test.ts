import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { visitRequests } from '@/db/schema';

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import {
  rescheduleByCustomerAction,
  rescheduleByExecAction,
} from '@/lib/reschedule/actions';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  seedCaptain,
  seedExecutive,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-320: the customer reschedule cap
// =============================================================================
//
// Before this, a tracking link was an unlimited reschedule token.
// /api/track/[token]/reschedule has no session — the token IS the
// credential — and the counter that existed (visit_requests.reschedule_count)
// was incremented and audited but never read for any decision. Each use
// also fires a customer WhatsApp plus in-app/push to the captain, the
// assigned exec and every super_admin, so it was a notification
// amplification vector as well as a data-integrity one.
//
// The cap counts history rows with a NULL rescheduled_by_user_id — the
// established "the customer did this" marker — NOT reschedule_count, which
// also counts exec reschedules. The exec-does-not-consume-quota case below
// is the one that would fail if we had used the shared counter.
// =============================================================================

/** A definite future moment, `daysFromNow` out at a fixed UTC hour. */
function futureIso(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  d.setUTCHours(6, 0, 0, 0); // 11:30 IST — clear of midnight boundaries
  return d.toISOString();
}

let seq = 0;
async function seedTrackableRequest() {
  seq += 1;
  const suffix = String(seq).padStart(5, '0');
  const captain = await seedCaptain({ phone: `+9193${suffix}0000` });
  const city = await getOrCreateCity('Bangalore');
  const exec = await seedExecutive(captain.id, {
    phone: `+9192${suffix}0000`,
    fullName: 'Exec CapTest',
    password: 'CapTest#1',
  });
  const req = await seedVisitRequest({
    cityId: city.id,
    assignedExecUserId: exec.id,
    assignedCaptainUserId: captain.id,
    statusStageCode: 'VISIT_SCHEDULED',
  });
  const [row] = await db
    .select({ token: visitRequests.trackingToken })
    .from(visitRequests)
    .where(eq(visitRequests.id, req.id))
    .limit(1);
  return { requestId: req.id, token: row!.token, exec };
}

describe('HVA-320: customer reschedule cap', () => {
  it('allows the first three customer reschedules and refuses the fourth', async () => {
    const { token } = await seedTrackableRequest();

    for (const day of [3, 4, 5]) {
      const res = await rescheduleByCustomerAction({
        token,
        toVisitScheduledAt: futureIso(day),
      });
      expect(res.ok).toBe(true);
    }

    const fourth = await rescheduleByCustomerAction({
      token,
      toVisitScheduledAt: futureIso(6),
    });
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) {
      // The customer must be told what to do next, not just refused.
      expect(fourth.error).toMatch(/already changed this date/i);
      expect(fourth.error).toMatch(/call us/i);
    }
  });

  it('does not move the date when the cap refuses the change', async () => {
    const { requestId, token } = await seedTrackableRequest();

    for (const day of [3, 4, 5]) {
      await rescheduleByCustomerAction({
        token,
        toVisitScheduledAt: futureIso(day),
      });
    }
    const [afterThird] = await db
      .select({ at: visitRequests.visitScheduledAt })
      .from(visitRequests)
      .where(eq(visitRequests.id, requestId));

    const blockedTarget = futureIso(9);
    const refused = await rescheduleByCustomerAction({
      token,
      toVisitScheduledAt: blockedTarget,
    });
    expect(refused.ok).toBe(false);

    const [afterRefusal] = await db
      .select({ at: visitRequests.visitScheduledAt })
      .from(visitRequests)
      .where(eq(visitRequests.id, requestId));
    expect(afterRefusal!.at?.toISOString()).toBe(afterThird!.at?.toISOString());
    expect(afterRefusal!.at?.toISOString()).not.toBe(blockedTarget);
  });

  it('an exec reschedule does not consume the customer\'s quota', async () => {
    // The reason the cap counts history rows rather than
    // visit_requests.reschedule_count: that counter is shared, so an exec
    // moving the date would silently burn one of the customer's three.
    const { requestId, token, exec } = await seedTrackableRequest();

    await rescheduleByCustomerAction({
      token,
      toVisitScheduledAt: futureIso(3),
    });
    await rescheduleByCustomerAction({
      token,
      toVisitScheduledAt: futureIso(4),
    });

    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const byExec = await rescheduleByExecAction({
      requestId,
      toVisitScheduledAt: futureIso(5),
      reason: 'Exec moving the visit for route planning',
    });
    expect(byExec.ok).toBe(true);
    currentCookieHeader = undefined;

    // The customer's third is still available despite four total moves.
    const third = await rescheduleByCustomerAction({
      token,
      toVisitScheduledAt: futureIso(6),
    });
    expect(third.ok).toBe(true);

    const fourth = await rescheduleByCustomerAction({
      token,
      toVisitScheduledAt: futureIso(7),
    });
    expect(fourth.ok).toBe(false);
  });

  it('the exec path is never capped', async () => {
    const { requestId, exec } = await seedTrackableRequest();

    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    for (const day of [3, 4, 5, 6, 7]) {
      const res = await rescheduleByExecAction({
        requestId,
        toVisitScheduledAt: futureIso(day),
        reason: `Exec reschedule number ${day} for route planning`,
      });
      expect(res.ok).toBe(true);
    }
    currentCookieHeader = undefined;
  });
});
