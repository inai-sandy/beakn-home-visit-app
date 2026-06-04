import { describe, expect, it } from 'vitest';

import {
  loadAllTransitions,
  loadTransitionByPair,
} from '@/lib/admin/transitions';

// =============================================================================
// HVA-223: status_transitions seed + loader regression
// =============================================================================
//
// Phase A asserts that migration 0060 seeded every legal transition
// currently enforced by lib/status-transition.ts. Behavior is byte-
// identical at deploy time; admin edits flip behavior thereafter.
// =============================================================================

describe('loadAllTransitions', () => {
  it('seeds 20 transitions: 9 forward + 1 forward_skip + 9 rollback + 1 specific_backward', async () => {
    const all = await loadAllTransitions();
    expect(all.length).toBe(20);

    const byKind = all.reduce<Record<string, number>>((acc, t) => {
      acc[t.kind] = (acc[t.kind] ?? 0) + 1;
      return acc;
    }, {});
    expect(byKind.forward).toBe(9);
    expect(byKind.forward_skip).toBe(1);
    expect(byKind.rollback).toBe(9);
    expect(byKind.specific_backward).toBe(1);
  });

  it('only ASSIGNED -> VISIT_SCHEDULED has requires_datetime=true after seed', async () => {
    const all = await loadAllTransitions();
    const datetimeRows = all.filter((t) => t.requiresDatetime);
    expect(datetimeRows.length).toBe(1);
    expect(datetimeRows[0]!.fromCode).toBe('ASSIGNED');
    expect(datetimeRows[0]!.toCode).toBe('VISIT_SCHEDULED');
  });

  it('HVA-68 forward_skip pair is INSTALLATION_SCHEDULED -> PENDING_CAPTAIN_APPROVAL', async () => {
    const all = await loadAllTransitions();
    const skip = all.find((t) => t.kind === 'forward_skip');
    expect(skip).toBeDefined();
    expect(skip!.fromCode).toBe('INSTALLATION_SCHEDULED');
    expect(skip!.toCode).toBe('PENDING_CAPTAIN_APPROVAL');
  });

  it('HVA-137 specific_backward pair is PENDING_CAPTAIN_APPROVAL -> INSTALLATION_SCHEDULED', async () => {
    const all = await loadAllTransitions();
    const reject = all.find((t) => t.kind === 'specific_backward');
    expect(reject).toBeDefined();
    expect(reject!.fromCode).toBe('PENDING_CAPTAIN_APPROVAL');
    expect(reject!.toCode).toBe('INSTALLATION_SCHEDULED');
    expect(reject!.allowedRole).toBe('captain');
    expect(reject!.requiresReason).toBe(true);
  });

  it('every consecutive seq pair has a forward row (1->2, 2->3, ... 9->10)', async () => {
    const all = await loadAllTransitions();
    const forwardOneStep = all.filter(
      (t) => t.kind === 'forward' && t.toSequence === t.fromSequence + 1,
    );
    expect(forwardOneStep.length).toBe(9);
  });

  it('rollback rows match -1 sequence delta', async () => {
    const all = await loadAllTransitions();
    const rollbacks = all.filter((t) => t.kind === 'rollback');
    for (const r of rollbacks) {
      expect(r.toSequence).toBe(r.fromSequence - 1);
    }
  });
});

describe('loadTransitionByPair', () => {
  it('returns requires_datetime=true for ASSIGNED -> VISIT_SCHEDULED', async () => {
    const row = await loadTransitionByPair('ASSIGNED', 'VISIT_SCHEDULED');
    expect(row).not.toBeNull();
    expect(row!.requiresDatetime).toBe(true);
    expect(row!.isActive).toBe(true);
    expect(row!.autoTaskType).toBe('customer_home_visit');
  });

  it('returns requires_datetime=false for ASSIGNED -> SUBMITTED rollback', async () => {
    const row = await loadTransitionByPair('ASSIGNED', 'SUBMITTED');
    expect(row).not.toBeNull();
    expect(row!.requiresDatetime).toBe(false);
  });

  it('returns null for an unseeded pair', async () => {
    const row = await loadTransitionByPair('SUBMITTED', 'ORDER_EXECUTED_SUCCESSFULLY');
    expect(row).toBeNull();
  });
});
