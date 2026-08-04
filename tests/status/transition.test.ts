import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  auditLog,
  quotations,
  requestStatusHistory,
  statusTransitions,
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

// HVA-309: seedCaptain/seedExecutive default to FIXED phone numbers and
// users.phone is UNIQUE, so a test that builds two scenarios (needed to
// assert one role is refused while another is allowed under the same
// config) would die on a duplicate key. Give every call its own phone.
// Single-scenario tests are unaffected — nothing asserts on these values.
let scenarioSeq = 0;

async function makeAssignableRequest(): Promise<{
  requestId: string;
  captainId: string;
  execId: string;
}> {
  scenarioSeq += 1;
  const suffix = String(scenarioSeq).padStart(8, '0');
  const city = await getOrCreateCity('Bangalore');
  const captain = await seedCaptain({ phone: `+9198${suffix}` });
  const exec = await seedExecutive(captain.id, { phone: `+9197${suffix}` });
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
  it('HVA-225 — rolls back when ASSIGNED → SUBMITTED rollback row is is_active=true (seed default)', async () => {
    // HVA-225 reframes this case. Pre-HVA-225 the engine rejected every
    // backward move without an explicit flag. Post-HVA-225 backward moves
    // are allowed iff the matching `status_transitions` row is_active.
    // The seed marks every rollback row active, so by default backward
    // transitions DO succeed via the rollback row's emits_event path.
    const { requestId, captainId } = await makeAssignableRequest();
    const assigned = await getStatusStage('ASSIGNED');
    const submitted = await getStatusStage('SUBMITTED');

    await transitionRequestStatus({
      requestId,
      nextStatusId: assigned.id,
      actorUserId: captainId,
      actorRole: 'captain',
    });

    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: submitted.id,
      actorUserId: captainId,
      actorRole: 'captain',
    });
    expect(result.ok).toBe(true);
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

  it('HVA-225 — rollback caller flag is now a no-op (table is the law)', async () => {
    // Pre-HVA-225 default behavior was to refuse rollback unless the
    // caller passed allowRollback=true. Post-HVA-225 the flag is a
    // no-op — the seeded rollback row's is_active=true is what allows
    // it. So omitting the flag now still succeeds.
    const { requestId, captainId } = await advanceToVisitScheduled();
    const assigned = await getStatusStage('ASSIGNED');

    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: assigned.id,
      actorUserId: captainId,
      actorRole: 'captain',
      // allowRollback NOT supplied — flag is deprecated. Engine still
      // allows the move because status_transitions has the row active.
    });
    expect(result.ok).toBe(true);
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

describe('HVA-137 transition service: allowSpecificBackwardTransition', () => {
  async function advanceTo(code: string): Promise<{
    requestId: string;
    captainId: string;
    execId: string;
  }> {
    const { requestId, captainId, execId } = await makeAssignableRequest();
    const stages = [
      'ASSIGNED',
      'VISIT_SCHEDULED',
      'VISIT_COMPLETED',
      'QUOTATION_GIVEN',
      'ORDER_CONFIRMED',
      'INSTALLATION_SCHEDULED',
      'INSTALLATION_CONFIGURATION_DONE',
      'PENDING_CAPTAIN_APPROVAL',
    ];
    for (const c of stages) {
      // HVA-314: VISIT_COMPLETED → QUOTATION_GIVEN now requires a quotation
      // row (migration 0085). In production only the CartPlus webhook can
      // satisfy that — it writes the quotation inside the same transaction
      // as the advance. Mirror that here rather than weakening the gate.
      if (c === 'QUOTATION_GIVEN') {
        await db
          .insert(quotations)
          .values({
            visitRequestId: requestId,
            totalOrderValuePaise: 100_000,
            submittedByUserId: captainId,
            source: 'portal',
          })
          .onConflictDoNothing();
      }
      const target = await getStatusStage(c);
      const result = await transitionRequestStatus({
        requestId,
        nextStatusId: target.id,
        actorUserId: captainId,
        actorRole: 'captain',
        preUpdate:
          c === 'ASSIGNED'
            ? async (tx) => {
                await tx
                  .update(visitRequests)
                  .set({
                    assignedExecUserId: execId,
                    assignedAt: new Date(),
                  })
                  .where(eq(visitRequests.id, requestId));
              }
            : undefined,
      });
      if (!result.ok)
        throw new Error(`fixture: failed to advance to ${c}: ${result.error}`);
      if (c === code) break;
    }
    return { requestId, captainId, execId };
  }

  it('accepts PENDING_CAPTAIN_APPROVAL → INSTALLATION_SCHEDULED when the named pair is set', async () => {
    const { requestId, captainId } = await advanceTo(
      'PENDING_CAPTAIN_APPROVAL',
    );
    const installation = await getStatusStage('INSTALLATION_SCHEDULED');

    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: installation.id,
      actorUserId: captainId,
      actorRole: 'captain',
      // HVA-225 seed keeps the captain-reject row strict: requires
      // reason. The legacy `allowSpecificBackwardTransition` flag is a
      // no-op now (table is the law) but the engine still needs the
      // reason because `requires_reason=true` on this row.
      reason: 'Installer needs to redo step 3',
      allowSpecificBackwardTransition: {
        fromCode: 'PENDING_CAPTAIN_APPROVAL',
        toCode: 'INSTALLATION_SCHEDULED',
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.previous.sequenceNumber).toBe(9);
      expect(result.current.sequenceNumber).toBe(7);
    }
  });

  it('rejects PENDING_CAPTAIN_APPROVAL → ASSIGNED even with the option set (wrong toCode)', async () => {
    const { requestId, captainId } = await advanceTo(
      'PENDING_CAPTAIN_APPROVAL',
    );
    const assigned = await getStatusStage('ASSIGNED');

    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: assigned.id,
      actorUserId: captainId,
      actorRole: 'captain',
      allowSpecificBackwardTransition: {
        fromCode: 'PENDING_CAPTAIN_APPROVAL',
        toCode: 'INSTALLATION_SCHEDULED',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('FORWARD_ONLY');
  });

  it('rejects VISIT_COMPLETED → ASSIGNED with the option (wrong fromCode)', async () => {
    const { requestId, captainId } = await advanceTo('VISIT_COMPLETED');
    const assigned = await getStatusStage('ASSIGNED');

    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: assigned.id,
      actorUserId: captainId,
      actorRole: 'captain',
      allowSpecificBackwardTransition: {
        fromCode: 'PENDING_CAPTAIN_APPROVAL',
        toCode: 'INSTALLATION_SCHEDULED',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('FORWARD_ONLY');
  });

  it('HVA-225 — allowSpecificBackwardTransition flag is now a no-op (table-driven)', async () => {
    // Pre-HVA-225 default behavior required the specific-pair flag to
    // permit PENDING_CAPTAIN_APPROVAL → INSTALLATION_SCHEDULED. Post-
    // HVA-225 the flag is a no-op — the seeded specific_backward row
    // with is_active=true authorises the move.
    const { requestId, captainId } = await advanceTo(
      'PENDING_CAPTAIN_APPROVAL',
    );
    const installation = await getStatusStage('INSTALLATION_SCHEDULED');

    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: installation.id,
      actorUserId: captainId,
      actorRole: 'captain',
      // No allowSpecificBackwardTransition — flag is deprecated. But
      // the seed keeps requires_reason=true on this row, so the engine
      // still needs a reason.
      reason: 'Send back for rework',
    });
    expect(result.ok).toBe(true);
  });
});

// =============================================================================
// HVA-309: the validation ladder's permission branches
// =============================================================================
//
// Before this block, four of the engine's five validation branches had no
// test at all — a repo-wide grep for ROLE_NOT_ALLOWED, TRANSITION_INACTIVE,
// REASON_REQUIRED and QUOTATION_REQUIRED returned zero hits across tests/.
// `actorRole` was only ever passed as an input value, never asserted on
// ('captain' in 20 of 21 calls above), so the role gate was effectively
// unverified while being the thing that enforces every workflow rule.
//
// WHY THE SAVE/RESTORE DANCE: `status_transitions` is deliberately NOT in
// SAFE_TRUNCATE_TABLES (tests/helpers/db.ts) — it is seeded once by
// migrations 0060/0070 and survives truncateAll() between tests. A mutation
// left behind here would silently change the workflow for every later test
// in the same worker DB: green in isolation, red (or worse, wrongly green)
// in a full run. withTransitionConfig restores in a `finally` so a failing
// assertion still cleans up after itself.
// =============================================================================

interface TransitionConfigPatch {
  allowedRole?: string;
  isActive?: boolean;
  requiresReason?: boolean;
  requiresQuotation?: boolean;
}

async function withTransitionConfig<T>(
  fromCode: string,
  toCode: string,
  patch: TransitionConfigPatch,
  fn: () => Promise<T>,
): Promise<T> {
  const from = await getStatusStage(fromCode);
  const to = await getStatusStage(toCode);
  const target = and(
    eq(statusTransitions.fromStageId, from.id),
    eq(statusTransitions.toStageId, to.id),
  );

  const [original] = await db
    .select({
      allowedRole: statusTransitions.allowedRole,
      isActive: statusTransitions.isActive,
      requiresReason: statusTransitions.requiresReason,
      requiresQuotation: statusTransitions.requiresQuotation,
    })
    .from(statusTransitions)
    .where(target)
    .limit(1);
  if (!original) {
    throw new Error(
      `status_transitions row missing for ${fromCode} → ${toCode}`,
    );
  }

  await db.update(statusTransitions).set(patch).where(target);
  try {
    return await fn();
  } finally {
    await db.update(statusTransitions).set(original).where(target);
  }
}

describe('HVA-309 validation ladder: allowed_role', () => {
  it('allowed_role=super_admin refuses a captain with ROLE_NOT_ALLOWED', async () => {
    const { requestId, captainId } = await makeAssignableRequest();
    const assigned = await getStatusStage('ASSIGNED');

    await withTransitionConfig(
      'SUBMITTED',
      'ASSIGNED',
      { allowedRole: 'super_admin' },
      async () => {
        const result = await transitionRequestStatus({
          requestId,
          nextStatusId: assigned.id,
          actorUserId: captainId,
          actorRole: 'captain',
        });

        expect(result.ok).toBe(false);
        if (!result.ok && result.error === 'ROLE_NOT_ALLOWED') {
          expect(result.status).toBe(403);
          expect(result.requiredRole).toBe('super_admin');
        } else {
          throw new Error(
            `expected ROLE_NOT_ALLOWED, got ${result.ok ? 'ok' : result.error}`,
          );
        }
      },
    );

    // The stage must not have moved.
    const [vr] = await db
      .select({ statusStageId: visitRequests.statusStageId })
      .from(visitRequests)
      .where(eq(visitRequests.id, requestId))
      .limit(1);
    expect(vr.statusStageId).not.toBe(assigned.id);
  });

  it('allowed_role=super_admin still lets super_admin through', async () => {
    const { requestId } = await makeAssignableRequest();
    const admin = await seedSuperAdmin();
    const assigned = await getStatusStage('ASSIGNED');

    await withTransitionConfig(
      'SUBMITTED',
      'ASSIGNED',
      { allowedRole: 'super_admin' },
      async () => {
        const result = await transitionRequestStatus({
          requestId,
          nextStatusId: assigned.id,
          actorUserId: admin.id,
          actorRole: 'super_admin',
        });
        expect(result.ok).toBe(true);
      },
    );
  });

  it('allowed_role=captain refuses a sales_executive but allows the captain', async () => {
    const assigned = await getStatusStage('ASSIGNED');

    await withTransitionConfig(
      'SUBMITTED',
      'ASSIGNED',
      { allowedRole: 'captain' },
      async () => {
        const refused = await makeAssignableRequest();
        const execResult = await transitionRequestStatus({
          requestId: refused.requestId,
          nextStatusId: assigned.id,
          actorUserId: refused.execId,
          actorRole: 'sales_executive',
        });
        expect(execResult.ok).toBe(false);
        if (!execResult.ok && execResult.error === 'ROLE_NOT_ALLOWED') {
          expect(execResult.requiredRole).toBe('captain');
        } else {
          throw new Error(
            `expected ROLE_NOT_ALLOWED for exec, got ${
              execResult.ok ? 'ok' : execResult.error
            }`,
          );
        }

        const allowed = await makeAssignableRequest();
        const captainResult = await transitionRequestStatus({
          requestId: allowed.requestId,
          nextStatusId: assigned.id,
          actorUserId: allowed.captainId,
          actorRole: 'captain',
        });
        expect(captainResult.ok).toBe(true);
      },
    );
  });

  it('super_admin bypasses even a captain-scoped transition', async () => {
    const { requestId } = await makeAssignableRequest();
    const admin = await seedSuperAdmin();
    const assigned = await getStatusStage('ASSIGNED');

    await withTransitionConfig(
      'SUBMITTED',
      'ASSIGNED',
      { allowedRole: 'captain' },
      async () => {
        const result = await transitionRequestStatus({
          requestId,
          nextStatusId: assigned.id,
          actorUserId: admin.id,
          actorRole: 'super_admin',
        });
        expect(result.ok).toBe(true);
      },
    );
  });
});

describe('HVA-309 validation ladder: is_active / reason / quotation', () => {
  it('is_active=false yields TRANSITION_INACTIVE, even for super_admin', async () => {
    const { requestId } = await makeAssignableRequest();
    const admin = await seedSuperAdmin();
    const assigned = await getStatusStage('ASSIGNED');

    await withTransitionConfig(
      'SUBMITTED',
      'ASSIGNED',
      { isActive: false },
      async () => {
        const result = await transitionRequestStatus({
          requestId,
          nextStatusId: assigned.id,
          actorUserId: admin.id,
          actorRole: 'super_admin',
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBe('TRANSITION_INACTIVE');
          expect(result.status).toBe(400);
        }
      },
    );
  });

  it('requires_reason=true rejects a missing reason and a whitespace-only one', async () => {
    const assigned = await getStatusStage('ASSIGNED');

    await withTransitionConfig(
      'SUBMITTED',
      'ASSIGNED',
      { requiresReason: true },
      async () => {
        const missing = await makeAssignableRequest();
        const noReason = await transitionRequestStatus({
          requestId: missing.requestId,
          nextStatusId: assigned.id,
          actorUserId: missing.captainId,
          actorRole: 'captain',
        });
        expect(noReason.ok).toBe(false);
        if (!noReason.ok) expect(noReason.error).toBe('REASON_REQUIRED');

        const blank = await makeAssignableRequest();
        const whitespace = await transitionRequestStatus({
          requestId: blank.requestId,
          nextStatusId: assigned.id,
          actorUserId: blank.captainId,
          actorRole: 'captain',
          reason: '   \t  ',
        });
        expect(whitespace.ok).toBe(false);
        if (!whitespace.ok) expect(whitespace.error).toBe('REASON_REQUIRED');

        const ok = await makeAssignableRequest();
        const withReason = await transitionRequestStatus({
          requestId: ok.requestId,
          nextStatusId: assigned.id,
          actorUserId: ok.captainId,
          actorRole: 'captain',
          reason: 'Assigning to the on-call exec',
        });
        expect(withReason.ok).toBe(true);
      },
    );
  });

  it('requires_quotation=true rejects a request with no quotation row', async () => {
    const { requestId, captainId } = await makeAssignableRequest();
    const assigned = await getStatusStage('ASSIGNED');

    await withTransitionConfig(
      'SUBMITTED',
      'ASSIGNED',
      { requiresQuotation: true },
      async () => {
        const result = await transitionRequestStatus({
          requestId,
          nextStatusId: assigned.id,
          actorUserId: captainId,
          actorRole: 'captain',
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBe('QUOTATION_REQUIRED');
          expect(result.status).toBe(400);
        }
      },
    );
  });

  it('restores the seeded config after each mutation (no bleed into later tests)', async () => {
    const from = await getStatusStage('SUBMITTED');
    const to = await getStatusStage('ASSIGNED');
    const [row] = await db
      .select({
        allowedRole: statusTransitions.allowedRole,
        isActive: statusTransitions.isActive,
        requiresReason: statusTransitions.requiresReason,
        requiresQuotation: statusTransitions.requiresQuotation,
      })
      .from(statusTransitions)
      .where(
        and(
          eq(statusTransitions.fromStageId, from.id),
          eq(statusTransitions.toStageId, to.id),
        ),
      )
      .limit(1);

    expect(row).toEqual({
      allowedRole: 'any',
      isActive: true,
      requiresReason: false,
      requiresQuotation: false,
    });
  });
});
