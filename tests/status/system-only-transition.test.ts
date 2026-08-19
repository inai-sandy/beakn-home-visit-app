import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import {
  quotations,
  requestStatusHistory,
  statusTransitions,
  visitRequests,
} from '@/db/schema';
import {
  SYSTEM_ONLY_OVERRIDE_REASON,
  transitionRequestStatus,
} from '@/lib/status-transition';

import {
  getOrCreateCity,
  getStatusStage,
  seedCaptain,
  seedExecutive,
  seedSuperAdmin,
  seedVisitRequest,
} from '../helpers/db';

// =============================================================================
// HVA-341: order confirmation may only come from CartPlus
// =============================================================================
//
// Sandeep, 2026-08-19, after watching CP-20260819-IWJHZ0 confirm itself in
// the portal moments after he confirmed it in CartPlus: "order confirmation
// should come from CartPlus... we will disable the button in our portal."
//
// CartPlus is the system of record for whether an order is real. Before this
// ticket an exec could assert it independently, and did — production shows 8
// manual confirmations against 8 from the webhook.
//
// What these tests pin:
//   * a person is refused with SYSTEM_ONLY, whatever their role
//   * super_admin still gets through — the escape hatch for a webhook that
//     never lands — and the history row says so, so a manual confirmation is
//     never mistaken for a real one
//   * the refusal is specific to this pair; the neighbouring transitions that
//     also touch ORDER_CONFIRMED keep working
//   * the CartPlus path is untouched (it never reads status_transitions)
// =============================================================================

let phoneSeq = 0;
function nextPhone(): string {
  phoneSeq += 1;
  return `+91977341${String(1000 + phoneSeq).padStart(4, '0')}`;
}

/**
 * A request parked at Quotation Given with a quotation row, i.e. exactly
 * where an order sits when CartPlus is about to confirm it.
 */
async function makeQuotedRequest() {
  const captain = await seedCaptain({ phone: nextPhone() });
  const exec = await seedExecutive(captain.id, { phone: nextPhone() });
  const admin = await seedSuperAdmin({ phone: nextPhone() });
  const city = await getOrCreateCity('Bangalore');
  const { id: requestId } = await seedVisitRequest({
    cityId: city.id,
    assignedExecUserId: exec.id,
    assignedCaptainUserId: captain.id,
    statusStageCode: 'QUOTATION_GIVEN',
  });
  await db.insert(quotations).values({
    visitRequestId: requestId,
    quotationNumber: `Q-341-${requestId.slice(0, 8)}`,
    totalOrderValuePaise: 500_000,
    submittedByUserId: exec.id,
    source: 'portal',
  });
  return { requestId, execId: exec.id, captainId: captain.id, adminId: admin.id };
}

describe('HVA-341 system_only: the portal cannot confirm an order', () => {
  it('is configured on QUOTATION_GIVEN → ORDER_CONFIRMED and nowhere else', async () => {
    const fromStage = await getStatusStage('QUOTATION_GIVEN');
    const toStage = await getStatusStage('ORDER_CONFIRMED');

    const flagged = await db
      .select({
        fromId: statusTransitions.fromStageId,
        toId: statusTransitions.toStageId,
        kind: statusTransitions.kind,
      })
      .from(statusTransitions)
      .where(eq(statusTransitions.systemOnly, true));

    expect(flagged).toHaveLength(1);
    expect(flagged[0].fromId).toBe(fromStage.id);
    expect(flagged[0].toId).toBe(toStage.id);
    expect(flagged[0].kind).toBe('forward');
  });

  it('leaves the row active — the button must stay visible, not vanish', async () => {
    // The alternative fix (is_active=false) would drop showAdvance and remove
    // the control entirely, which is the "it was there before, now it's gone"
    // failure HVA-314 exists to prevent. If someone ever "simplifies" this to
    // an is_active toggle, this test is what objects.
    const fromStage = await getStatusStage('QUOTATION_GIVEN');
    const toStage = await getStatusStage('ORDER_CONFIRMED');
    const [row] = await db
      .select({
        isActive: statusTransitions.isActive,
        allowedRole: statusTransitions.allowedRole,
        requiresReason: statusTransitions.requiresReason,
      })
      .from(statusTransitions)
      .where(
        and(
          eq(statusTransitions.fromStageId, fromStage.id),
          eq(statusTransitions.toStageId, toStage.id),
        ),
      )
      .limit(1);

    expect(row.isActive).toBe(true);
    // allowed_role stays 'any': the refusal must name CartPlus, not send the
    // exec off asking to be granted a role that would not help.
    expect(row.allowedRole).toBe('any');
    // requires_reason stays false — the forward button has no reason dialog,
    // so demanding one would make the super_admin override impossible to use.
    expect(row.requiresReason).toBe(false);
  });

  it('refuses a sales executive with SYSTEM_ONLY', async () => {
    const { requestId, execId } = await makeQuotedRequest();
    const confirmed = await getStatusStage('ORDER_CONFIRMED');

    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: confirmed.id,
      actorUserId: execId,
      actorRole: 'sales_executive',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('SYSTEM_ONLY');
      expect(result.status).toBe(403);
      expect(result.message).toContain('CartPlus');
    }

    // and nothing moved
    const [vr] = await db
      .select({ statusStageId: visitRequests.statusStageId })
      .from(visitRequests)
      .where(eq(visitRequests.id, requestId))
      .limit(1);
    expect(vr.statusStageId).not.toBe(confirmed.id);

    const history = await db
      .select({ id: requestStatusHistory.id })
      .from(requestStatusHistory)
      .where(eq(requestStatusHistory.requestId, requestId));
    expect(history).toHaveLength(0);
  });

  it('refuses a captain too — no role unlocks it', async () => {
    const { requestId, captainId } = await makeQuotedRequest();
    const confirmed = await getStatusStage('ORDER_CONFIRMED');

    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: confirmed.id,
      actorUserId: captainId,
      actorRole: 'captain',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('SYSTEM_ONLY');
  });

  it('refuses even though the quotation requirement is satisfied', async () => {
    // Guards against a future reading of the refusal as "there is no
    // quotation yet". There is one; the answer is still no.
    const { requestId, execId } = await makeQuotedRequest();
    const [quote] = await db
      .select({ id: quotations.id })
      .from(quotations)
      .where(eq(quotations.visitRequestId, requestId));
    expect(quote).toBeDefined();

    const confirmed = await getStatusStage('ORDER_CONFIRMED');
    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: confirmed.id,
      actorUserId: execId,
      actorRole: 'sales_executive',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toBe('QUOTATION_REQUIRED');
  });
});

describe('HVA-341 system_only: super_admin keeps an audited override', () => {
  it('lets super_admin through and stamps the history row', async () => {
    const { requestId, adminId } = await makeQuotedRequest();
    const confirmed = await getStatusStage('ORDER_CONFIRMED');

    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: confirmed.id,
      actorUserId: adminId,
      actorRole: 'super_admin',
    });

    expect(result.ok).toBe(true);

    const [vr] = await db
      .select({ statusStageId: visitRequests.statusStageId })
      .from(visitRequests)
      .where(eq(visitRequests.id, requestId))
      .limit(1);
    expect(vr.statusStageId).toBe(confirmed.id);

    // The point of the stamp: "who decided this order was real?" must have an
    // answer, and a manual confirmation must not read like a CartPlus one.
    const history = await db
      .select({ reason: requestStatusHistory.reason })
      .from(requestStatusHistory)
      .where(eq(requestStatusHistory.requestId, requestId));
    expect(history).toHaveLength(1);
    expect(history[0].reason).toBe(SYSTEM_ONLY_OVERRIDE_REASON);
    expect(history[0].reason).toContain('SUPER_ADMIN_OVERRIDE');
  });

  it("keeps the admin's own reason when they supply one", async () => {
    const { requestId, adminId } = await makeQuotedRequest();
    const confirmed = await getStatusStage('ORDER_CONFIRMED');

    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: confirmed.id,
      actorUserId: adminId,
      actorRole: 'super_admin',
      reason: 'CartPlus webhook outage 2026-08-19, confirmed by phone',
    });

    expect(result.ok).toBe(true);
    const history = await db
      .select({ reason: requestStatusHistory.reason })
      .from(requestStatusHistory)
      .where(eq(requestStatusHistory.requestId, requestId));
    expect(history[0].reason).toBe(
      'CartPlus webhook outage 2026-08-19, confirmed by phone',
    );
  });
});

describe('HVA-341 system_only: blast radius', () => {
  it('does not stamp an ordinary forward transition', async () => {
    // VISIT_SCHEDULED → VISIT_COMPLETED is untouched config; if the override
    // reason leaked onto every transition this would catch it.
    const captain = await seedCaptain({ phone: nextPhone() });
    const exec = await seedExecutive(captain.id, { phone: nextPhone() });
    const city = await getOrCreateCity('Bangalore');
    const { id: requestId } = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
      statusStageCode: 'VISIT_SCHEDULED',
    });
    const completed = await getStatusStage('VISIT_COMPLETED');

    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: completed.id,
      actorUserId: exec.id,
      actorRole: 'sales_executive',
    });

    expect(result.ok).toBe(true);
    const history = await db
      .select({ reason: requestStatusHistory.reason })
      .from(requestStatusHistory)
      .where(eq(requestStatusHistory.requestId, requestId));
    expect(history[0].reason).toBeNull();
  });

  it('still allows the rollback from Installation Scheduled back to Order Confirmed', async () => {
    // A second, separate path lands on ORDER_CONFIRMED. Scoping the migration
    // to kind='forward' is what keeps it working; this is the test that fails
    // if a future migration flags the stage instead of the pair.
    const captain = await seedCaptain({ phone: nextPhone() });
    const exec = await seedExecutive(captain.id, { phone: nextPhone() });
    const city = await getOrCreateCity('Bangalore');
    const { id: requestId } = await seedVisitRequest({
      cityId: city.id,
      assignedExecUserId: exec.id,
      assignedCaptainUserId: captain.id,
      statusStageCode: 'INSTALLATION_SCHEDULED',
    });
    const confirmed = await getStatusStage('ORDER_CONFIRMED');

    const result = await transitionRequestStatus({
      requestId,
      nextStatusId: confirmed.id,
      actorUserId: exec.id,
      actorRole: 'sales_executive',
      allowRollback: true,
    });

    expect(result.ok).toBe(true);
  });
});
