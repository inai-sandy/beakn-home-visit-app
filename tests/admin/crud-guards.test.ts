import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { auditLog, captains, cities, salesExecutives, users } from '@/db/schema';

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import { POST as deactivateCaptain } from '@/app/api/admin/captains/[id]/deactivate/route';
import { POST as activateCaptain } from '@/app/api/admin/captains/[id]/activate/route';
import { POST as deactivateExec } from '@/app/api/admin/executives/[id]/deactivate/route';

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
// HVA-109 Area 4: HVA-91/92 CRUD guards (deactivate + RBAC + audit)
// =============================================================================
//
// Schema reality verified against shipped code:
//   - audit_log.event_type values emitted by these handlers:
//       'captain_deactivated', 'captain_activated',
//       'executive_deactivated', 'executive_activated'
//   - cities.captain_user_id is the captain↔city link (NOT users.captain_id).
//   - sales_executives.captain_user_id is the team link.
//   - Exec-deactivate gates on "open assigned requests" — counts
//     visit_requests.assigned_exec_user_id = exec AND status_stage_id !=
//     terminal. Terminal = MAX(sequence_number) per HVA-67 dynamic rule.
//
// SHIPPED-BEHAVIOR REALITY (deviates from HVA-109 issue body's claim):
//   - Captain deactivate is NOT blocked when execs are assigned to that
//     captain. The shipped handler always proceeds, atomically:
//       1. UPDATE cities SET captain_user_id = NULL where captain_user_id = <cap>
//       2. UPDATE users SET is_active = false where id = <cap>
//       3. DELETE sessions for <cap>
//     Sales_executives rows are NOT touched — they keep their
//     captain_user_id pointing at the now-inactive captain. This is the
//     intentional design from HVA-91's deploy summary: deactivation is
//     single-purpose and admin reassigns orphan execs via the executive's
//     Edit modal afterwards.
//   - Tests codify the SHIPPED behavior, not the issue body's claim. The
//     issue body's "deactivate captain with active execs assigned →
//     blocked" expectation is wrong against the deployed code.
//
// =============================================================================

function buildReq(): Request {
  return new Request('https://visits.beakn.in/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  });
}
function buildCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('CRUD guards: RBAC', () => {
  it('anonymous on captain deactivate → 401', async () => {
    const cap = await seedCaptain();
    currentCookieHeader = undefined;
    const res = await deactivateCaptain(buildReq(), buildCtx(cap.id));
    expect(res.status).toBe(401);
  });

  it('captain attempting to deactivate another captain → 403', async () => {
    const capA = await seedCaptain();
    const capB = await seedCaptain({ phone: '+919000099999' });
    const sess = await loginByPhone(capA.phone, capA.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await deactivateCaptain(buildReq(), buildCtx(capB.id));
    expect(res.status).toBe(403);
  });

  it('sales_executive attempting to deactivate a captain → 403', async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await deactivateCaptain(buildReq(), buildCtx(cap.id));
    expect(res.status).toBe(403);
  });
});

describe('CRUD guards: captain deactivate semantics', () => {
  it('HVA-113: captain WITH active execs → 409 with names + count, DB unchanged', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;

    const cap = await seedCaptain();
    const blr = await getOrCreateCity('Bangalore');
    await db
      .update(cities)
      .set({ captainUserId: cap.id })
      .where(eq(cities.id, blr.id));
    const exec = await seedExecutive(cap.id, {
      fullName: 'Active Exec',
    });

    const res = await deactivateCaptain(buildReq(), buildCtx(cap.id));
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      ok: boolean;
      error: string;
      execCount: number;
      execNames: string[];
    };
    expect(body.ok).toBe(false);
    expect(body.execCount).toBe(1);
    expect(body.execNames).toEqual(['Active Exec']);
    expect(body.error).toMatch(/Cannot deactivate/i);

    // DB unchanged — captain still active, city still held, no audit row.
    const [u] = await db
      .select({ isActive: users.isActive })
      .from(users)
      .where(eq(users.id, cap.id))
      .limit(1);
    expect(u.isActive).toBe(true);

    const stillHeld = await db
      .select({ id: cities.id })
      .from(cities)
      .where(eq(cities.captainUserId, cap.id));
    expect(stillHeld.length).toBe(1);

    const audit = await db
      .select({ eventType: auditLog.eventType })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, cap.id));
    expect(audit.length).toBe(0);

    void exec;
  });

  it('HVA-113: captain WITHOUT active execs (only inactive) → succeeds, cities unassigned', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;

    const cap = await seedCaptain();
    const blr = await getOrCreateCity('Bangalore');
    const chn = await getOrCreateCity('Chennai');
    await db
      .update(cities)
      .set({ captainUserId: cap.id })
      .where(eq(cities.id, blr.id));
    await db
      .update(cities)
      .set({ captainUserId: cap.id })
      .where(eq(cities.id, chn.id));
    // Seed an INACTIVE exec — the gate should ignore it (only active execs
    // block deactivation).
    await seedExecutive(cap.id, { isActive: false });

    const res = await deactivateCaptain(buildReq(), buildCtx(cap.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      citiesUnassigned: string[];
    };
    expect(body.ok).toBe(true);
    expect([...body.citiesUnassigned].sort()).toEqual(['Bangalore', 'Chennai']);

    const [u] = await db
      .select({ isActive: users.isActive })
      .from(users)
      .where(eq(users.id, cap.id))
      .limit(1);
    expect(u.isActive).toBe(false);

    const audit = await db
      .select({ eventType: auditLog.eventType })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, cap.id));
    expect(audit.length).toBe(1);
    expect(audit[0].eventType).toBe('captain_deactivated');
  });

  it('captain already inactive → 409', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;
    const cap = await seedCaptain({ isActive: false });

    const res = await deactivateCaptain(buildReq(), buildCtx(cap.id));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/already inactive/i);
  });

  it('captain id pointing at a non-captain user → 404', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await deactivateCaptain(buildReq(), buildCtx(sa.id));
    expect(res.status).toBe(404);
  });
});

describe('CRUD guards: captain activate', () => {
  it('deactivate then activate → flips back to is_active=true + audit row', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;
    const cap = await seedCaptain({ isActive: false });

    const res = await activateCaptain(buildReq(), buildCtx(cap.id));
    expect(res.status).toBe(200);

    const [u] = await db
      .select({ isActive: users.isActive })
      .from(users)
      .where(eq(users.id, cap.id))
      .limit(1);
    expect(u.isActive).toBe(true);

    const audit = await db
      .select({ eventType: auditLog.eventType })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, cap.id));
    expect(audit.map((a) => a.eventType)).toContain('captain_activated');
  });
});

describe('CRUD guards: exec deactivate gates on open requests', () => {
  it('exec WITH an open assigned request → 409 (blocked) + openRequestCount', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;

    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const city = await getOrCreateCity('Bangalore');
    await db
      .update(cities)
      .set({ captainUserId: cap.id })
      .where(eq(cities.id, city.id));
    // Open assigned request in ASSIGNED stage (not terminal).
    await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: cap.id,
      statusStageCode: 'ASSIGNED',
    });

    const res = await deactivateExec(buildReq(), buildCtx(exec.id));
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      openRequestCount: number;
    };
    expect(body.error).toMatch(/open request/i);
    expect(body.openRequestCount).toBe(1);

    // No mutation — exec stays active.
    const [u] = await db
      .select({ isActive: users.isActive })
      .from(users)
      .where(eq(users.id, exec.id))
      .limit(1);
    expect(u.isActive).toBe(true);
  });

  it('exec whose only assigned request is at TERMINAL stage → deactivation succeeds', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;

    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const city = await getOrCreateCity('Bangalore');
    await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: cap.id,
      statusStageCode: 'ORDER_EXECUTED_SUCCESSFULLY',
    });

    const res = await deactivateExec(buildReq(), buildCtx(exec.id));
    expect(res.status).toBe(200);

    const [u] = await db
      .select({ isActive: users.isActive })
      .from(users)
      .where(eq(users.id, exec.id))
      .limit(1);
    expect(u.isActive).toBe(false);

    const audit = await db
      .select({ eventType: auditLog.eventType })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, exec.id));
    expect(audit.map((a) => a.eventType)).toContain('executive_deactivated');
  });

  it('exec with NO assigned requests at all → deactivation succeeds', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;

    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);

    const res = await deactivateExec(buildReq(), buildCtx(exec.id));
    expect(res.status).toBe(200);
  });
});

// Silence type-only imports for the lint pass.
void captains;
void getStatusStage;
