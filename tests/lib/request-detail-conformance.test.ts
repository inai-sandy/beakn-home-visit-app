import { asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { statusStages, statusTransitions } from '@/db/schema';
import { computeActionVisibility } from '@/lib/request-detail';

// =============================================================================
// HVA-310: the UI's button rules must agree with the seeded workflow config
// =============================================================================
//
// The unit tests in request-detail.test.ts prove the gate logic works for
// hand-written config. This file runs it against the REAL seeded
// `status_transitions` rows, which is where drift actually happens: someone
// changes a row in a migration (or an admin flips it at
// /admin/settings/workflow/transitions) and the UI silently disagrees.
//
// `status_transitions` is not in SAFE_TRUNCATE_TABLES, so the migration seed
// is present here and these assertions run against production-shaped data.
//
// Two guards:
//   1. every row's allowed_role is a value the app actually understands —
//      the column is a free varchar with no CHECK constraint (HVA-313 adds
//      one), and a typo would silently lock the transition to super_admin;
//   2. an explicit inventory of every row that is NOT wide open. Changing
//      the workflow is fine, but it must be a deliberate, reviewed edit to
//      this list rather than something that lands unnoticed.
// =============================================================================

const EXEC_ID = '11111111-1111-7111-8111-111111111111';
const CAPTAIN_ID = '22222222-2222-7222-8222-222222222222';

/** Values the engine and the admin UI both understand. */
const KNOWN_ALLOWED_ROLES = new Set([
  'any',
  'sales_executive',
  'captain',
  'super_admin',
]);

interface SeededTransition {
  fromCode: string;
  toCode: string;
  kind: string;
  allowedRole: string;
  isActive: boolean;
  requiresQuotation: boolean;
  systemOnly: boolean;
}

async function loadSeededTransitions(): Promise<SeededTransition[]> {
  const fromStage = alias(statusStages, 'from_stage');
  const toStage = alias(statusStages, 'to_stage');
  return db
    .select({
      fromCode: fromStage.code,
      toCode: toStage.code,
      kind: statusTransitions.kind,
      allowedRole: statusTransitions.allowedRole,
      isActive: statusTransitions.isActive,
      requiresQuotation: statusTransitions.requiresQuotation,
      systemOnly: statusTransitions.systemOnly,
    })
    .from(statusTransitions)
    .innerJoin(fromStage, eq(fromStage.id, statusTransitions.fromStageId))
    .innerJoin(toStage, eq(toStage.id, statusTransitions.toStageId))
    .orderBy(asc(fromStage.sequenceNumber), asc(toStage.sequenceNumber));
}

describe('seeded status_transitions are expressible by the UI', () => {
  it('finds the seeded workflow at all', async () => {
    // Canary — status_transitions survives truncateAll, so an empty result
    // means the harness changed and every assertion below is vacuous.
    const rows = await loadSeededTransitions();
    expect(rows.length).toBeGreaterThan(15);
  });

  it('uses only allowed_role values the engine understands', async () => {
    const rows = await loadSeededTransitions();
    const unknown = rows
      .filter((r) => !KNOWN_ALLOWED_ROLES.has(r.allowedRole))
      .map((r) => `${r.fromCode} → ${r.toCode}: '${r.allowedRole}'`);
    // A value outside this set matches no actor role, so the transition
    // becomes super_admin-only by accident rather than by decision.
    expect(unknown).toEqual([]);
  });

  it('inventories every transition that is restricted or disabled', async () => {
    const rows = await loadSeededTransitions();
    const restricted = rows
      .filter((r) => r.allowedRole !== 'any' || !r.isActive || r.systemOnly)
      .map(
        (r) =>
          `${r.fromCode} → ${r.toCode} [${r.kind}] role=${r.allowedRole} active=${r.isActive}${r.systemOnly ? ' system_only' : ''}`,
      );

    // Deliberately an exact-match assertion. Widening or narrowing who can
    // move a request is a product decision; it should surface in review as
    // a diff to this list, not slip through because nothing asserted on it.
    //
    // Updated by HVA-313/HVA-314 (migration 0085), which turned the gates on
    // after Sandeep's walk found the pipeline clickable end to end with
    // nothing refusing. Each line below is a rule he asked for:
    //   - Order Confirmed is a one-way door (decision 16)
    //   - installation must be marked finished before captain approval —
    //     the forward_skip shortcut is off (decision 21)
    //   - captain reject is the only backward path from approval (0060)
    //   - Captain Approval is a one-way door (decision 17)
    //   - the terminal rollback row is unreachable, so it no longer claims
    //     to be available (decision 3)
    //   - HVA-341 (migration 0091): order confirmation is CartPlus's to make,
    //     so the manual forward step is system_only. Note it stays
    //     role='any' and active=true on purpose — the button must render
    //     disabled with a reason, not disappear.
    expect(restricted).toEqual([
      'QUOTATION_GIVEN → ORDER_CONFIRMED [forward] role=any active=true system_only',
      'ORDER_CONFIRMED → QUOTATION_GIVEN [rollback] role=super_admin active=true',
      'INSTALLATION_SCHEDULED → PENDING_CAPTAIN_APPROVAL [forward_skip] role=any active=false',
      'PENDING_CAPTAIN_APPROVAL → INSTALLATION_SCHEDULED [specific_backward] role=captain active=true',
      'PENDING_CAPTAIN_APPROVAL → INSTALLATION_CONFIGURATION_DONE [rollback] role=super_admin active=true',
      'ORDER_EXECUTED_SUCCESSFULLY → PENDING_CAPTAIN_APPROVAL [rollback] role=any active=false',
    ]);
  });

  it('keeps the advance control OFFERED for a system_only row (HVA-341)', async () => {
    // The whole point of system_only over is_active=false. computeActionVisibility
    // must still say "show the button" so the page can render it disabled with
    // "Order confirmation comes from CartPlus"; a vanished control is the
    // failure mode Sandeep reported in August and HVA-314 was written to fix.
    const rows = await loadSeededTransitions();
    const gate = rows.find((r) => r.systemOnly);
    expect(gate).toBeDefined();

    const vis = computeActionVisibility({
      role: 'sales_executive',
      userId: EXEC_ID,
      currentStageCode: gate!.fromCode,
      assignedExecUserId: EXEC_ID,
      cityCaptainUserId: CAPTAIN_ID,
      cancelledAt: null,
      hasNextStage: true,
      hasPreviousStage: true,
      nextTransition: {
        allowedRole: gate!.allowedRole,
        isActive: gate!.isActive,
      },
    });

    expect(vis.showAdvance).toBe(true);
  });

  it('requires a quotation before Quotation Given (HVA-314)', async () => {
    // The gate that would have stopped the request Sandeep walked, which
    // reached ORDER_CONFIRMED with zero quotation rows. Quotations are
    // raised and revised in CartPlus; the portal must never mint one.
    const rows = await loadSeededTransitions();
    const gate = rows.find(
      (r) => r.fromCode === 'VISIT_COMPLETED' && r.toCode === 'QUOTATION_GIVEN',
    );
    expect(gate).toBeDefined();
    expect(gate!.requiresQuotation).toBe(true);
  });
});

describe('UI visibility agrees with the seeded config', () => {
  it('never offers Rollback for a row the engine would refuse', async () => {
    const rows = await loadSeededTransitions();
    const offenders: string[] = [];
    let offeredCount = 0;

    for (const row of rows) {
      // Only backward pairs can drive the Rollback button.
      if (row.kind !== 'rollback') continue;

      for (const actor of [
        { role: 'sales_executive' as const, userId: EXEC_ID },
        { role: 'captain' as const, userId: CAPTAIN_ID },
      ]) {
        const vis = computeActionVisibility({
          role: actor.role,
          userId: actor.userId,
          currentStageCode: row.fromCode,
          assignedExecUserId: EXEC_ID,
          cityCaptainUserId: CAPTAIN_ID,
          cancelledAt: null,
          hasNextStage: true,
          hasPreviousStage: true,
          previousTransition: {
            allowedRole: row.allowedRole,
            isActive: row.isActive,
          },
        });

        const engineWouldRefuse =
          !row.isActive ||
          (row.allowedRole !== 'any' && row.allowedRole !== actor.role);

        if (vis.showRollback) offeredCount += 1;
        if (vis.showRollback && engineWouldRefuse) {
          offenders.push(
            `${actor.role} offered rollback ${row.fromCode} → ${row.toCode} (role=${row.allowedRole}, active=${row.isActive})`,
          );
        }
      }
    }

    // Positive control. Every seeded rollback is currently allowed_role='any'
    // and active, so `offenders` would be empty even if the gate were wired
    // up wrong — or not wired at all. Asserting the loop actually produced
    // visible buttons is what stops this passing vacuously until HVA-313
    // introduces the first restricted rollback.
    expect(offeredCount).toBeGreaterThan(0);

    // Each entry here is a button that renders and then 403s or 400s.
    expect(offenders).toEqual([]);
  });
});
