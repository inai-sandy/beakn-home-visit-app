import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  auditLog,
  cities,
  requestStatusHistory,
  visitRequests,
} from '@/db/schema';

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import { POST } from '@/app/api/requests/[id]/mark-customer-rejected/route';
import { POST as statusPOST } from '@/app/api/requests/[id]/status/route';
import { POST as markCompletePOST } from '@/app/api/requests/[id]/mark-installation-complete/route';

import { loginByPhone } from '../helpers/auth';
import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-69: POST /api/requests/[id]/mark-customer-rejected
// =============================================================================
//
// Schema reality verified:
//   - Reuses HVA-39's cancellation columns on visit_requests:
//       cancelled_at, cancellation_actor (enum: customer/exec/captain/admin),
//       cancelled_by_user_id, cancellation_reason (text — repurposed as note).
//   - NEW column: cancellation_reason_code varchar(64) (migration 0010).
//   - status_stages NOT mutated: terminal flag is cancelled_at, orthogonal
//     to the forward pipeline. Status_stage_id stays where it was.
//   - audit_log event_type='customer_rejection_marked' (migration 0010 +
//     lib/config-schema.ts default).
// =============================================================================

function buildReq(body: unknown = {}): Request {
  return new Request(
    'https://visits.beakn.in/api/requests/x/mark-customer-rejected',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

function buildCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function seedRequestAtStage(
  stageCode = 'VISIT_SCHEDULED',
  cityName = 'Bangalore',
) {
  const city = await getOrCreateCity(cityName);
  const captain = await seedCaptain();
  await db
    .update(cities)
    .set({ captainUserId: captain.id })
    .where(eq(cities.id, city.id));
  const exec = await seedExecutive(captain.id);
  const req = await seedVisitRequest({
    cityId: city.id,
    statusStageCode: stageCode,
    assignedExecUserId: exec.id,
    assignedCaptainUserId: captain.id,
  });
  return { city, captain, exec, req };
}

describe('mark-customer-rejected: RBAC', () => {
  it('anonymous → 401', async () => {
    currentCookieHeader = undefined;
    const { req } = await seedRequestAtStage();
    const res = await POST(
      buildReq({ reason: 'PRICE_TOO_HIGH' }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(401);
  });

  it('assigned exec → allowed', async () => {
    const { exec, req } = await seedRequestAtStage();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ reason: 'PRICE_TOO_HIGH' }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(200);
  });

  it('captain of the city → allowed', async () => {
    const { captain, req } = await seedRequestAtStage();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ reason: 'CHANGED_MIND' }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(200);
  });

  it('super_admin → allowed (escape hatch)', async () => {
    const { req } = await seedRequestAtStage();
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ reason: 'NO_LONGER_INTERESTED' }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(200);
  });

  it('other sales_executive (not assigned) → 403', async () => {
    const { captain, req } = await seedRequestAtStage();
    const otherExec = await seedExecutive(captain.id, { phone: '+919100069999' });
    const sess = await loginByPhone(otherExec.phone, otherExec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ reason: 'PRICE_TOO_HIGH' }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/assigned executive/i);
  });

  it('captain of a DIFFERENT city → 403', async () => {
    const { req } = await seedRequestAtStage('VISIT_SCHEDULED', 'Bangalore');
    const chennai = await getOrCreateCity('Chennai');
    const otherCaptain = await seedCaptain({ phone: '+919000069999' });
    await db
      .update(cities)
      .set({ captainUserId: otherCaptain.id })
      .where(eq(cities.id, chennai.id));
    const sess = await loginByPhone(otherCaptain.phone, otherCaptain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ reason: 'PRICE_TOO_HIGH' }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not in your assigned city/i);
  });
});

describe('mark-customer-rejected: validation', () => {
  it('rejects missing reason → 400 fieldError', async () => {
    const { exec, req } = await seedRequestAtStage();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(buildReq({}), buildCtx(req.id));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fieldErrors?: Record<string, string> };
    expect(body.fieldErrors?.reason).toBeDefined();
  });

  it('rejects bogus enum value → 400', async () => {
    const { exec, req } = await seedRequestAtStage();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ reason: 'TOTALLY_MADE_UP' }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(400);
  });

  it('rejects OTHER without a note → 400 fieldError on note', async () => {
    const { exec, req } = await seedRequestAtStage();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(buildReq({ reason: 'OTHER' }), buildCtx(req.id));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fieldErrors?: Record<string, string> };
    expect(body.fieldErrors?.note).toMatch(/Other.*required/i);
  });

  it('rejects OTHER with a note shorter than 10 chars → 400', async () => {
    const { exec, req } = await seedRequestAtStage();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ reason: 'OTHER', note: 'too short' }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fieldErrors?: Record<string, string> };
    expect(body.fieldErrors?.note).toMatch(/at least 10/i);
  });

  it('rejects a note over 500 chars → 400', async () => {
    const { exec, req } = await seedRequestAtStage();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const tooLong = 'x'.repeat(501);
    const res = await POST(
      buildReq({ reason: 'PRICE_TOO_HIGH', note: tooLong }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fieldErrors?: Record<string, string> };
    expect(body.fieldErrors?.note).toMatch(/500/);
  });
});

describe('mark-customer-rejected: happy paths', () => {
  it('PRICE_TOO_HIGH with no note → DB columns set, history written, audit written', async () => {
    const { exec, req } = await seedRequestAtStage();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ reason: 'PRICE_TOO_HIGH' }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      cancelledAt: string;
      cancellationActor: string;
      cancellationReasonCode: string;
      cancellationReason: string | null;
    };
    expect(body.ok).toBe(true);
    expect(body.cancellationActor).toBe('exec');
    expect(body.cancellationReasonCode).toBe('PRICE_TOO_HIGH');
    expect(body.cancellationReason).toBeNull();

    const [vr] = await db
      .select({
        cancelledAt: visitRequests.cancelledAt,
        cancellationActor: visitRequests.cancellationActor,
        cancelledByUserId: visitRequests.cancelledByUserId,
        cancellationReasonCode: visitRequests.cancellationReasonCode,
        cancellationReason: visitRequests.cancellationReason,
      })
      .from(visitRequests)
      .where(eq(visitRequests.id, req.id))
      .limit(1);
    expect(vr.cancelledAt).not.toBeNull();
    expect(vr.cancellationActor).toBe('exec');
    expect(vr.cancelledByUserId).toBe(exec.id);
    expect(vr.cancellationReasonCode).toBe('PRICE_TOO_HIGH');
    expect(vr.cancellationReason).toBeNull();

    const history = await db
      .select({ reason: requestStatusHistory.reason })
      .from(requestStatusHistory)
      .where(eq(requestStatusHistory.requestId, req.id));
    const rejectionEntry = history.find((h) => h.reason?.startsWith('REJECTED:'));
    expect(rejectionEntry).toBeDefined();
    expect(rejectionEntry?.reason).toMatch(/Price too high/);

    const audit = await db
      .select({
        eventType: auditLog.eventType,
        actorRole: auditLog.actorRole,
        afterState: auditLog.afterState,
      })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, req.id));
    const rejAudit = audit.find(
      (a) => a.eventType === 'customer_rejection_marked',
    );
    expect(rejAudit).toBeDefined();
    expect(rejAudit?.actorRole).toBe('sales_executive');
    expect(rejAudit?.afterState).toMatchObject({
      cancellationActor: 'exec',
      cancellationReasonCode: 'PRICE_TOO_HIGH',
      cancellationReason: null,
    });
  });

  it('OTHER with a >=10-char note → note stored verbatim', async () => {
    const { exec, req } = await seedRequestAtStage();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const note = 'Customer is moving to a new city next month, no longer needed.';

    const res = await POST(
      buildReq({ reason: 'OTHER', note }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(200);

    const [vr] = await db
      .select({
        cancellationReasonCode: visitRequests.cancellationReasonCode,
        cancellationReason: visitRequests.cancellationReason,
      })
      .from(visitRequests)
      .where(eq(visitRequests.id, req.id))
      .limit(1);
    expect(vr.cancellationReasonCode).toBe('OTHER');
    expect(vr.cancellationReason).toBe(note);
  });

  it('captain happy path → cancellationActor=captain', async () => {
    const { captain, req } = await seedRequestAtStage();
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ reason: 'FOUND_ALTERNATIVE' }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(200);

    const [vr] = await db
      .select({
        cancellationActor: visitRequests.cancellationActor,
        cancelledByUserId: visitRequests.cancelledByUserId,
      })
      .from(visitRequests)
      .where(eq(visitRequests.id, req.id))
      .limit(1);
    expect(vr.cancellationActor).toBe('captain');
    expect(vr.cancelledByUserId).toBe(captain.id);
  });

  it('super_admin happy path → cancellationActor=admin', async () => {
    const { req } = await seedRequestAtStage();
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ reason: 'CHANGED_MIND' }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(200);

    const [vr] = await db
      .select({ cancellationActor: visitRequests.cancellationActor })
      .from(visitRequests)
      .where(eq(visitRequests.id, req.id))
      .limit(1);
    expect(vr.cancellationActor).toBe('admin');
  });
});

describe('mark-customer-rejected: terminal-state guards', () => {
  it('cannot re-mark an already-rejected request → 409', async () => {
    const { exec, req } = await seedRequestAtStage();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    await POST(buildReq({ reason: 'PRICE_TOO_HIGH' }), buildCtx(req.id));
    const res = await POST(
      buildReq({ reason: 'CHANGED_MIND' }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(409);
  });

  it('cannot reject a fulfilled (ORDER_EXECUTED_SUCCESSFULLY) request → 409', async () => {
    const { exec, req } = await seedRequestAtStage(
      'ORDER_EXECUTED_SUCCESSFULLY',
    );
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ reason: 'PRICE_TOO_HIGH' }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(409);
  });
});

describe('terminal-state defensive gates on adjacent endpoints', () => {
  it('rejected request cannot be advanced via /status (any role) → 409', async () => {
    const { exec, captain, req } = await seedRequestAtStage();
    const execSess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = execSess.cookieHeader;
    await POST(buildReq({ reason: 'PRICE_TOO_HIGH' }), buildCtx(req.id));

    const capSess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = capSess.cookieHeader;
    const next = await getStatusStage('VISIT_COMPLETED');
    const statusRes = await statusPOST(
      new Request('https://visits.beakn.in/api/requests/x/status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nextStatusId: next.id }),
      }),
      buildCtx(req.id),
    );
    expect(statusRes.status).toBe(409);
    const sb = (await statusRes.json()) as { error: string };
    expect(sb.error).toMatch(/terminal-rejected/i);
  });

  it('rejected request cannot be marked complete via /mark-installation-complete → 409', async () => {
    const { exec, req } = await seedRequestAtStage('INSTALLATION_SCHEDULED');
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    await POST(buildReq({ reason: 'PRICE_TOO_HIGH' }), buildCtx(req.id));

    const mcRes = await markCompletePOST(
      new Request(
        'https://visits.beakn.in/api/requests/x/mark-installation-complete',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
      ),
      buildCtx(req.id),
    );
    expect(mcRes.status).toBe(409);
    const mb = (await mcRes.json()) as { error: string };
    expect(mb.error).toMatch(/terminal-rejected/i);
  });
});

describe('mark-customer-rejected: misc', () => {
  it('unknown request UUID → 404', async () => {
    const { exec } = await seedRequestAtStage();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ reason: 'PRICE_TOO_HIGH' }),
      buildCtx('00000000-0000-7000-8000-000000000000'),
    );
    expect(res.status).toBe(404);
  });

  it('bad UUID id → 400', async () => {
    const { exec } = await seedRequestAtStage();
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(
      buildReq({ reason: 'PRICE_TOO_HIGH' }),
      buildCtx('not-a-uuid'),
    );
    expect(res.status).toBe(400);
  });
});
