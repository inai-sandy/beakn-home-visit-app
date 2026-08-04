import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { requestRescheduleHistory, visitRequests } from '@/db/schema';

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9' }),
  cookies: async () => ({ get: () => undefined }),
}));

import { POST as reschedulePost } from '@/app/api/track/[token]/reschedule/route';

import { getOrCreateCity, seedCaptain, seedExecutive, seedVisitRequest } from '../helpers/db';

// =============================================================================
// HVA-322: the public tracking endpoints are rate-limited
// =============================================================================
//
// /api/track/[token]/reschedule and .../cancel have no session — the token in
// the URL is the only credential. HVA-320 capped how many reschedules can
// SUCCEED; nothing capped how many could be ATTEMPTED, and every accepted one
// fires a customer WhatsApp plus in-app and push to the captain, the assigned
// exec and every super_admin.
//
// The property worth asserting is not "returns 429" on its own — it is that a
// refused attempt changes nothing and tells nobody. A limiter that rejects the
// response after doing the work would look correct from the outside and still
// spam the team.
// =============================================================================

const RATE_LIMIT_MAX = 10;

function futureIso(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  d.setUTCHours(6, 0, 0, 0);
  return d.toISOString();
}

function buildReq(body: unknown): Request {
  return new Request('https://visits.beakn.in/api/track/x/reschedule', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

let seq = 0;
async function seedTrackable() {
  seq += 1;
  const suffix = String(seq).padStart(5, '0');
  const captain = await seedCaptain({ phone: `+9194${suffix}0000` });
  const city = await getOrCreateCity('Bangalore');
  const exec = await seedExecutive(captain.id, { phone: `+9196${suffix}0000` });
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
  return { requestId: req.id, token: row!.token };
}

describe('HVA-322: /track reschedule rate limit', () => {
  it('refuses past the window cap and writes nothing on the refusal', async () => {
    const { requestId, token } = await seedTrackable();

    // Burn the window. Most of these are refused by the HVA-320 business cap
    // (3 successful customer reschedules) — which is the point: a REJECTED
    // attempt still consumes a rate-limit slot, because the limiter exists to
    // stop hammering, not just to stop succeeding.
    for (let i = 0; i < RATE_LIMIT_MAX; i += 1) {
      await reschedulePost(
        buildReq({ toVisitScheduledAt: futureIso(3 + i) }),
        { params: Promise.resolve({ token }) },
      );
    }

    const historyBefore = await db
      .select({ id: requestRescheduleHistory.id })
      .from(requestRescheduleHistory)
      .where(eq(requestRescheduleHistory.requestId, requestId));
    const [beforeRow] = await db
      .select({ at: visitRequests.visitScheduledAt })
      .from(visitRequests)
      .where(eq(visitRequests.id, requestId))
      .limit(1);

    const res = await reschedulePost(
      buildReq({ toVisitScheduledAt: futureIso(40) }),
      { params: Promise.resolve({ token }) },
    );
    expect(res.status).toBe(429);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/too many/i);

    // Nothing was written by the refused attempt.
    const historyAfter = await db
      .select({ id: requestRescheduleHistory.id })
      .from(requestRescheduleHistory)
      .where(eq(requestRescheduleHistory.requestId, requestId));
    expect(historyAfter.length).toBe(historyBefore.length);

    const [afterRow] = await db
      .select({ at: visitRequests.visitScheduledAt })
      .from(visitRequests)
      .where(eq(visitRequests.id, requestId))
      .limit(1);
    expect(afterRow!.at?.toISOString()).toBe(beforeRow!.at?.toISOString());
  });

  it('leaves a customer within the window unaffected', async () => {
    // The quota must not be so tight that normal use trips it. A first
    // reschedule on a fresh token always succeeds.
    const { token } = await seedTrackable();
    const res = await reschedulePost(
      buildReq({ toVisitScheduledAt: futureIso(5) }),
      { params: Promise.resolve({ token }) },
    );
    expect(res.status).toBe(200);
  });

  it('scopes the quota per token, not globally', async () => {
    // Keying on the token rather than the IP is the whole design: customers
    // share NAT, so an IP-keyed quota would let one abuser lock out a
    // building. Burning one token's quota must not touch another's.
    const first = await seedTrackable();
    for (let i = 0; i < RATE_LIMIT_MAX + 1; i += 1) {
      await reschedulePost(
        buildReq({ toVisitScheduledAt: futureIso(3 + i) }),
        { params: Promise.resolve({ token: first.token }) },
      );
    }

    const second = await seedTrackable();
    const res = await reschedulePost(
      buildReq({ toVisitScheduledAt: futureIso(5) }),
      { params: Promise.resolve({ token: second.token }) },
    );
    expect(res.status).toBe(200);
  });
});
