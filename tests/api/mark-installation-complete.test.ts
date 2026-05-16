import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import {
  auditLog,
  cities,
  requestStatusHistory,
  statusStages,
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

import { POST } from '@/app/api/requests/[id]/mark-installation-complete/route';

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
// HVA-68: POST /api/requests/[id]/mark-installation-complete
// =============================================================================
//
// Schema reality verified:
//   - status_stages seeded names: INSTALLATION_SCHEDULED (seq 7),
//     INSTALLATION_CONFIGURATION_DONE (seq 8), PENDING_CAPTAIN_APPROVAL (seq 9).
//   - request_status_history.reason is text nullable — used for the
//     optional completion note.
//   - lib/status-transition.ts was extended with allowForwardSkip flag
//     (still strictly forward — just relaxed +1 → > current).
//   - audit_log event_type='installation_marked_complete' added to
//     allow-list via migration 0009 + lib/config-schema.ts default.
// =============================================================================

function buildReq(body: unknown = {}): Request {
  return new Request(
    'https://visits.beakn.in/api/requests/x/mark-installation-complete',
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

async function seedRequestAtStage(stageCode: string) {
  const city = await getOrCreateCity('Bangalore');
  const captain = await seedCaptain();
  await db
    .update(cities)
    .set({ captainUserId: captain.id })
    .where(eq(cities.id, city.id));
  const exec = await seedExecutive(captain.id);
  const stage = await getStatusStage(stageCode);
  // visit_requests insert: seedVisitRequest uses status code to look up the
  // stage id. We set assigned_exec_user_id to the exec we just made.
  const req = await seedVisitRequest({
    cityId: city.id,
    statusStageCode: stage.code,
    assignedExecUserId: exec.id,
    assignedCaptainUserId: captain.id,
  });
  return { city, captain, exec, req };
}

describe('mark-installation-complete: RBAC', () => {
  it('rejects anonymous with 401', async () => {
    currentCookieHeader = undefined;
    const { req } = await seedRequestAtStage('INSTALLATION_SCHEDULED');
    const res = await POST(buildReq(), buildCtx(req.id));
    expect(res.status).toBe(401);
  });

  it('rejects captain (this is an exec action; captain ships in HVA-80)', async () => {
    const { captain, req } = await seedRequestAtStage('INSTALLATION_SCHEDULED');
    const sess = await loginByPhone(captain.phone, captain.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(buildReq(), buildCtx(req.id));
    expect(res.status).toBe(403);
  });

  it('rejects a different sales_executive (not assigned to this request)', async () => {
    const { captain, req } = await seedRequestAtStage('INSTALLATION_SCHEDULED');
    // Seed a different exec on the same captain.
    const otherExec = await seedExecutive(captain.id, {
      phone: '+919100099999',
    });
    const sess = await loginByPhone(otherExec.phone, otherExec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await POST(buildReq(), buildCtx(req.id));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not the assigned executive/i);
  });
});

describe('mark-installation-complete: happy path', () => {
  it('from INSTALLATION_SCHEDULED (seq 7) → PENDING_CAPTAIN_APPROVAL (seq 9) — forward skip allowed', async () => {
    const { exec, req } = await seedRequestAtStage('INSTALLATION_SCHEDULED');
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq({ note: 'All 6 switches installed, demo done.' }),
      buildCtx(req.id),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      previousStage: { sequenceNumber: number; name: string };
      currentStage: { sequenceNumber: number; name: string };
    };
    expect(body.ok).toBe(true);
    expect(body.previousStage.sequenceNumber).toBe(7);
    expect(body.currentStage.sequenceNumber).toBe(9);
    expect(body.currentStage.name).toBe('Pending Captain Approval');

    // visit_requests row updated.
    const target = await getStatusStage('PENDING_CAPTAIN_APPROVAL');
    const [vr] = await db
      .select({ statusStageId: visitRequests.statusStageId })
      .from(visitRequests)
      .where(eq(visitRequests.id, req.id))
      .limit(1);
    expect(vr.statusStageId).toBe(target.id);

    // request_status_history written with the note in `reason`.
    const history = await db
      .select({
        toStageId: requestStatusHistory.toStatusStageId,
        reason: requestStatusHistory.reason,
      })
      .from(requestStatusHistory)
      .where(eq(requestStatusHistory.requestId, req.id));
    expect(history.length).toBe(1);
    expect(history[0].toStageId).toBe(target.id);
    expect(history[0].reason).toBe('All 6 switches installed, demo done.');

    // audit_log carries both status_change AND installation_marked_complete.
    const audit = await db
      .select({
        eventType: auditLog.eventType,
        actorRole: auditLog.actorRole,
        afterState: auditLog.afterState,
      })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, req.id));
    const types = audit.map((a) => a.eventType).sort();
    expect(types).toContain('status_change');
    expect(types).toContain('installation_marked_complete');
    const mark = audit.find((a) => a.eventType === 'installation_marked_complete');
    expect(mark?.actorRole).toBe('sales_executive');
    expect(mark?.afterState).toMatchObject({
      statusStageCode: 'PENDING_CAPTAIN_APPROVAL',
      note: 'All 6 switches installed, demo done.',
    });
  });

  it('from INSTALLATION_CONFIGURATION_DONE (seq 8) → PENDING_CAPTAIN_APPROVAL (seq 9) — strict +1 also works', async () => {
    const { exec, req } = await seedRequestAtStage(
      'INSTALLATION_CONFIGURATION_DONE',
    );
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq(), buildCtx(req.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      previousStage: { sequenceNumber: number };
      currentStage: { sequenceNumber: number };
    };
    expect(body.previousStage.sequenceNumber).toBe(8);
    expect(body.currentStage.sequenceNumber).toBe(9);
  });

  it('without a note → still succeeds, audit afterState.note=null', async () => {
    const { exec, req } = await seedRequestAtStage('INSTALLATION_SCHEDULED');
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq(), buildCtx(req.id));
    expect(res.status).toBe(200);

    const audit = await db
      .select({
        eventType: auditLog.eventType,
        afterState: auditLog.afterState,
      })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, req.id));
    const mark = audit.find((a) => a.eventType === 'installation_marked_complete');
    expect(mark?.afterState).toMatchObject({ note: null });
  });

  it('super_admin escape hatch — can mark complete on a request they did not own', async () => {
    const { req } = await seedRequestAtStage('INSTALLATION_SCHEDULED');
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq({ note: 'admin-override' }), buildCtx(req.id));
    expect(res.status).toBe(200);
    const audit = await db
      .select({ actorRole: auditLog.actorRole })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, req.id));
    const mark = audit.find((a) => a.actorRole === 'super_admin');
    expect(mark).toBeDefined();
  });
});

describe('mark-installation-complete: stage gate', () => {
  it('rejects when current stage is SUBMITTED (seq 1) → 409', async () => {
    const { exec, req } = await seedRequestAtStage('SUBMITTED');
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq(), buildCtx(req.id));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/only valid from Installation/i);
  });

  it('rejects when current stage is already PENDING_CAPTAIN_APPROVAL (idempotency) → 409', async () => {
    const { exec, req } = await seedRequestAtStage('PENDING_CAPTAIN_APPROVAL');
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq(), buildCtx(req.id));
    expect(res.status).toBe(409);
  });

  it('rejects from ORDER_EXECUTED_SUCCESSFULLY (terminal, seq 10) → 409', async () => {
    const { exec, req } = await seedRequestAtStage('ORDER_EXECUTED_SUCCESSFULLY');
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq(), buildCtx(req.id));
    expect(res.status).toBe(409);
  });
});

describe('mark-installation-complete: validation', () => {
  it('rejects a note longer than 500 chars → 400 + fieldError', async () => {
    const { exec, req } = await seedRequestAtStage('INSTALLATION_SCHEDULED');
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const tooLong = 'x'.repeat(501);
    const res = await POST(buildReq({ note: tooLong }), buildCtx(req.id));
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      fieldErrors?: Record<string, string>;
    };
    expect(body.fieldErrors?.note).toMatch(/500/);
  });

  it('accepts a note of exactly 500 chars', async () => {
    const { exec, req } = await seedRequestAtStage('INSTALLATION_SCHEDULED');
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const max = 'x'.repeat(500);
    const res = await POST(buildReq({ note: max }), buildCtx(req.id));
    expect(res.status).toBe(200);
    const history = await db
      .select({ reason: requestStatusHistory.reason })
      .from(requestStatusHistory)
      .where(eq(requestStatusHistory.requestId, req.id));
    expect(history[0].reason?.length).toBe(500);
  });

  it('rejects bad UUID id → 400', async () => {
    const { exec } = await seedRequestAtStage('INSTALLATION_SCHEDULED');
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(buildReq(), buildCtx('not-a-uuid'));
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown request UUID', async () => {
    const { exec } = await seedRequestAtStage('INSTALLATION_SCHEDULED');
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await POST(
      buildReq(),
      buildCtx('00000000-0000-7000-8000-000000000000'),
    );
    expect(res.status).toBe(404);
  });
});

// Suppress unused-import: statusStages is referenced indirectly via helpers.
void statusStages;
