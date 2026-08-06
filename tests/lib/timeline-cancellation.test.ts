import { describe, expect, it } from 'vitest';

import { isStageTransition } from '@/lib/request-timeline';

// =============================================================================
// HVA-332: a cancellation must not render as a stage row
// =============================================================================
//
// Cancellation writes a `from = to` row — the stage never moves, only a reason
// is attached. Every timeline labels a row by its to-stage, so those rows
// rendered as a duplicate of whatever stage the request was sitting at,
// directly above the real "Cancelled" entry.
//
// Removing the filter on the /track page puts the duplicate straight back.
// =============================================================================

const STAGE_A = '019e2b91-13e2-7121-9f11-179332a16d62';
const STAGE_B = '019e2b91-13e2-7121-9f11-179332a16d63';

describe('isStageTransition', () => {
  it('keeps a real forward transition', () => {
    expect(isStageTransition({ fromStageId: STAGE_A, toStageId: STAGE_B })).toBe(
      true,
    );
  });

  it('keeps a rollback — it moved the request, just backwards', () => {
    expect(isStageTransition({ fromStageId: STAGE_B, toStageId: STAGE_A })).toBe(
      true,
    );
  });

  it('keeps the very first row, which has no from-stage', () => {
    // `fromStageId` is null there, not equal — dropping it would delete
    // "Submitted" from every customer's timeline.
    expect(isStageTransition({ fromStageId: null, toStageId: STAGE_A })).toBe(
      true,
    );
  });

  // The defect. Both live shapes:
  //   ORDER_CONFIRMED  -> ORDER_CONFIRMED  (CANCELLED_BY_CUSTOMER, CartPlus)
  //   VISIT_SCHEDULED  -> VISIT_SCHEDULED  (CANCELLED_BY_CUSTOMER, /track)
  it('drops a from = to cancellation row at any stage', () => {
    expect(isStageTransition({ fromStageId: STAGE_A, toStageId: STAGE_A })).toBe(
      false,
    );
    expect(isStageTransition({ fromStageId: STAGE_B, toStageId: STAGE_B })).toBe(
      false,
    );
  });

  it('is keyed on stage identity, not on the reason text', () => {
    // Matching `CANCELLED_BY_CUSTOMER:` would miss the next writer that adopts
    // the same from = to shape — and HVA-325 records that apply-status.ts
    // "sets that precedent". The structural rule needs no reason at all.
    const rowWithNoReasonAvailable = {
      fromStageId: STAGE_A,
      toStageId: STAGE_A,
    };
    expect(isStageTransition(rowWithNoReasonAvailable)).toBe(false);
  });
});
