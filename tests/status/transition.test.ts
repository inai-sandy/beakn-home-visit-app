import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  auditLog,
  requestStatusHistory,
  visitRequests,
} from '@/db/schema';
import { transitionRequestStatus } from '@/lib/status-transition';

import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-101 / Area 2: HVA-67 forward-only status transition service
// =============================================================================
//
// Directly call transitionRequestStatus() with a real seeded request. The
// function does the FK joins, runs the validation pipeline, executes the
// transaction, and writes the history + audit rows itself — so a green
// test means the full vertical works.
// =============================================================================

async function makeAssignableRequest(): Promise<{
  requestId: string;
  captainId: string;
  execId: string;
}> {
  const city = await getOrCreateCity('Bangalore');
  const captain = await seedCaptain();
  const exec = await seedExecutive(captain.id);
  // Start at SUBMITTED so we can advance forward to ASSIGNED in tests.
  const req = await seedVisitRequest({
    cityId: city.id,
    statusStageCode: 'SUBMITTED',
  });
  return { requestId: req.id, captainId: captain.id, execId: exec.id };
}

describe('HVA-67 transition service: forward path', () => {
  it('advances SUBMITTED → ASSIGNED, writes history + audit row', async () => {
    const { requestId, captainId } = await makeAssignableRequest();
    const assigned = await getStatusStage('ASSIGNED');

    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: assigned.id,
      actorUserId: captainId,
      actorRole: 'captain',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.previous.sequenceNumber).toBe(1);
      expect(result.current.sequenceNumber).toBe(2);
      expect(result.current.name).toBe('Assigned');
    }

    // DB-side: visit_requests.status_stage_id updated.
    const [vr] = await db
      .select({ statusStageId: visitRequests.statusStageId })
      .from(visitRequests)
      .where(eq(visitRequests.id, requestId))
      .limit(1);
    expect(vr.statusStageId).toBe(assigned.id);

    // history row written.
    const history = await db
      .select({
        fromStageId: requestStatusHistory.fromStatusStageId,
        toStageId: requestStatusHistory.toStatusStageId,
        actorId: requestStatusHistory.changedByUserId,
      })
      .from(requestStatusHistory)
      .where(eq(requestStatusHistory.requestId, requestId));
    expect(history.length).toBe(1);
    expect(history[0].toStageId).toBe(assigned.id);
    expect(history[0].actorId).toBe(captainId);

    // audit row written (status_change event_type seeded in allow-list).
    const audit = await db
      .select({
        eventType: auditLog.eventType,
        actorRole: auditLog.actorRole,
        targetEntityId: auditLog.targetEntityId,
      })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, requestId));
    expect(audit.length).toBeGreaterThanOrEqual(1);
    const statusChange = audit.find((a) => a.eventType === 'status_change');
    expect(statusChange).toBeDefined();
    expect(statusChange?.actorRole).toBe('captain');
  });
});

describe('HVA-67 transition service: rejections', () => {
  it('rejects backwards transition with FORWARD_ONLY', async () => {
    const { requestId, captainId } = await makeAssignableRequest();
    const assigned = await getStatusStage('ASSIGNED');
    const submitted = await getStatusStage('SUBMITTED');

    // Move forward first.
    await transitionRequestStatus({
      requestId,
      nextStatusId: assigned.id,
      actorUserId: captainId,
      actorRole: 'captain',
    });

    // Now attempt SUBMITTED ← ASSIGNED.
    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: submitted.id,
      actorUserId: captainId,
      actorRole: 'captain',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('FORWARD_ONLY');
      expect(result.status).toBe(400);
    }
  });

  it('rejects skip-stage transition (SUBMITTED → VISIT_SCHEDULED) with FORWARD_ONLY', async () => {
    const { requestId, captainId } = await makeAssignableRequest();
    const visitScheduled = await getStatusStage('VISIT_SCHEDULED');

    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: visitScheduled.id,
      actorUserId: captainId,
      actorRole: 'captain',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('FORWARD_ONLY');
      if (result.error === 'FORWARD_ONLY') {
        expect(result.currentSequence).toBe(1);
        expect(result.attemptedSequence).toBe(3);
      }
    }
  });

  it('rejects invalid nextStatusId with STAGE_NOT_FOUND', async () => {
    const { requestId, captainId } = await makeAssignableRequest();

    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: '00000000-0000-7000-8000-000000000000',
      actorUserId: captainId,
      actorRole: 'captain',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('STAGE_NOT_FOUND');
  });

  it('rejects unknown requestId with REQUEST_NOT_FOUND', async () => {
    const sa = await seedSuperAdmin();
    const assigned = await getStatusStage('ASSIGNED');
    const result = await transitionRequestStatus({
      requestId: '00000000-0000-7000-8000-000000000000',
      nextStatusId: assigned.id,
      actorUserId: sa.id,
      actorRole: 'super_admin',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('REQUEST_NOT_FOUND');
  });

  it('rejects advance past the terminal stage with TERMINAL_STAGE', async () => {
    const city = await getOrCreateCity('Bangalore');
    const captain = await seedCaptain();
    const terminal = await getStatusStage('ORDER_EXECUTED_SUCCESSFULLY');
    const req = await seedVisitRequest({
      cityId: city.id,
      statusStageCode: 'ORDER_EXECUTED_SUCCESSFULLY',
    });

    // Attempt to "advance" past terminal — pick any other stage.
    const result = await transitionRequestStatus({
      requestId: req.id,
      nextStatusId: terminal.id, // self, but the seq check fires first
      actorUserId: captain.id,
      actorRole: 'captain',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('TERMINAL_STAGE');
  });
});

describe('HVA-67 transition service: preUpdate hook composes (HVA-81 path)', () => {
  it('runs the caller-supplied preUpdate inside the transaction', async () => {
    const { requestId, captainId, execId } = await makeAssignableRequest();
    const assigned = await getStatusStage('ASSIGNED');

    let preUpdateRan = false;
    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: assigned.id,
      actorUserId: captainId,
      actorRole: 'captain',
      preUpdate: async (tx) => {
        preUpdateRan = true;
        // HVA-81 pattern: pair the status transition with an exec
        // assignment write. Use the supplied tx so it commits atomically.
        await tx
          .update(visitRequests)
          .set({ assignedExecUserId: execId, assignedAt: new Date() })
          .where(eq(visitRequests.id, requestId));
      },
    });
    expect(result.ok).toBe(true);
    expect(preUpdateRan).toBe(true);

    // Both writes committed in one tx.
    const [vr] = await db
      .select({
        statusStageId: visitRequests.statusStageId,
        assignedExecUserId: visitRequests.assignedExecUserId,
      })
      .from(visitRequests)
      .where(eq(visitRequests.id, requestId))
      .limit(1);
    expect(vr.statusStageId).toBe(assigned.id);
    expect(vr.assignedExecUserId).toBe(execId);
  });
});

describe('HVA-141 transition service: allowRollback', () => {
  async function advanceToVisitScheduled(): Promise<{
    requestId: string;
    captainId: string;
  }> {
    const { requestId, captainId } = await makeAssignableRequest();
    const assigned = await getStatusStage('ASSIGNED');
    const visitScheduled = await getStatusStage('VISIT_SCHEDULED');
    await transitionRequestStatus({
      requestId,
      nextStatusId: assigned.id,
      actorUserId: captainId,
      actorRole: 'captain',
    });
    await transitionRequestStatus({
      requestId,
      nextStatusId: visitScheduled.id,
      actorUserId: captainId,
      actorRole: 'captain',
    });
    return { requestId, captainId };
  }

  it('allowRollback=true with target seq = current-1 succeeds and writes a new history row', async () => {
    const { requestId, captainId } = await advanceToVisitScheduled();
    const assigned = await getStatusStage('ASSIGNED');

    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: assigned.id,
      actorUserId: captainId,
      actorRole: 'captain',
      allowRollback: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.previous.sequenceNumber).toBe(3);
      expect(result.current.sequenceNumber).toBe(2);
    }

    // visit_requests reflects the rollback.
    const [vr] = await db
      .select({ statusStageId: visitRequests.statusStageId })
      .from(visitRequests)
      .where(eq(visitRequests.id, requestId))
      .limit(1);
    expect(vr.statusStageId).toBe(assigned.id);

    // history has 3 rows now: SUBMITTED→ASSIGNED, ASSIGNED→VISIT_SCHEDULED,
    // VISIT_SCHEDULED→ASSIGNED. The new row gets the next transition_order
    // (3) and doesn't collide with the existing ASSIGNED row at seq 2.
    const history = await db
      .select({
        toStageId: requestStatusHistory.toStatusStageId,
        sequenceNumber: requestStatusHistory.sequenceNumber,
        transitionOrder: requestStatusHistory.transitionOrder,
      })
      .from(requestStatusHistory)
      .where(eq(requestStatusHistory.requestId, requestId));
    expect(history.length).toBe(3);
    const rollback = history.find((h) => h.transitionOrder === 3);
    expect(rollback).toBeDefined();
    expect(rollback?.toStageId).toBe(assigned.id);
    expect(rollback?.sequenceNumber).toBe(2);
  });

  it('allowRollback=true with target seq = current-2 rejects with FORWARD_ONLY (one step only)', async () => {
    const { requestId, captainId } = await advanceToVisitScheduled();
    const submitted = await getStatusStage('SUBMITTED');

    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: submitted.id,
      actorUserId: captainId,
      actorRole: 'captain',
      allowRollback: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('FORWARD_ONLY');
      if (result.error === 'FORWARD_ONLY') {
        expect(result.currentSequence).toBe(3);
        expect(result.attemptedSequence).toBe(1);
      }
    }
  });

  it('allowRollback=false (default) with target seq = current-1 still rejects', async () => {
    const { requestId, captainId } = await advanceToVisitScheduled();
    const assigned = await getStatusStage('ASSIGNED');

    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: assigned.id,
      actorUserId: captainId,
      actorRole: 'captain',
      // allowRollback NOT supplied — defaults to false.
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('FORWARD_ONLY');
  });

  it('allowRollback=true with target seq = current+1 still succeeds (forward path unaffected)', async () => {
    const { requestId, captainId } = await makeAssignableRequest();
    const assigned = await getStatusStage('ASSIGNED');

    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: assigned.id,
      actorUserId: captainId,
      actorRole: 'captain',
      allowRollback: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.current.sequenceNumber).toBe(2);
  });
});
