import { describe, expect, it } from 'vitest';

import {
  computeActionVisibility,
  formatIstDateTime,
  terminalBadgeMeta,
} from '@/lib/request-detail';

// =============================================================================
// HVA-66: unit tests for the page's pure helpers
// =============================================================================
//
// /requests/[id] is a server component — we can't render it under vitest
// without RTL setup. Instead, the page's role × stage visibility logic
// lives in lib/request-detail.ts (this file's targets) so it's fully
// testable in isolation.
//
// What's covered here:
//   - formatIstDateTime: ISO-string + Date inputs, null/invalid edge cases
//   - computeActionVisibility: full role × stage × ownership matrix
//   - terminalBadgeMeta: customer/exec/captain/admin/null variants
//
// What's NOT covered here (covered by separate suites):
//   - The route handlers behind each button (mark-customer-rejected,
//     mark-installation-complete, status) — those are in tests/api/.
// =============================================================================

const EXEC_ID = '11111111-1111-7111-8111-111111111111';
const CAPTAIN_ID = '22222222-2222-7222-8222-222222222222';
const ADMIN_ID = '33333333-3333-7333-8333-333333333333';
const OTHER_USER_ID = '44444444-4444-7444-8444-444444444444';

function baseInput() {
  return {
    role: 'sales_executive' as const,
    userId: EXEC_ID,
    currentStageCode: 'VISIT_SCHEDULED',
    assignedExecUserId: EXEC_ID,
    cityCaptainUserId: CAPTAIN_ID,
    cancelledAt: null,
    hasNextStage: true,
  };
}

describe('formatIstDateTime', () => {
  it('formats a fixed UTC Date as a IST-suffixed string', () => {
    // 2026-05-16T10:00:00Z → 15:30 IST (UTC+05:30) → "16 May 2026, 3:30 pm IST"
    const out = formatIstDateTime(new Date('2026-05-16T10:00:00Z'));
    expect(out).toMatch(/16 May 2026/);
    expect(out).toMatch(/IST$/);
  });

  it('accepts an ISO string', () => {
    const out = formatIstDateTime('2026-05-16T10:00:00Z');
    expect(out).toMatch(/IST$/);
  });

  it('returns null for null/undefined input', () => {
    expect(formatIstDateTime(null)).toBeNull();
    expect(formatIstDateTime(undefined)).toBeNull();
  });

  it('returns null for invalid date strings', () => {
    expect(formatIstDateTime('not-a-date')).toBeNull();
  });
});

describe('computeActionVisibility — terminal short-circuits', () => {
  it('all-false when request is terminal (cancelled_at set)', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      cancelledAt: new Date(),
    });
    expect(out).toEqual({
      showMarkRejected: false,
      showMarkComplete: false,
      showAdvance: false,
      showAssignExec: false,
    });
  });

  it('all-false when there is no next stage (already at terminal pipeline)', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      currentStageCode: 'ORDER_EXECUTED_SUCCESSFULLY',
      hasNextStage: false,
    });
    expect(out).toEqual({
      showMarkRejected: false,
      showMarkComplete: false,
      showAdvance: false,
      showAssignExec: false,
    });
  });
});

describe('computeActionVisibility — Assign Sales Executive (HVA-139)', () => {
  it('captain-of-city at SUBMITTED → showAssignExec true, showAdvance false', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      role: 'captain',
      userId: CAPTAIN_ID,
      currentStageCode: 'SUBMITTED',
      assignedExecUserId: null,
    });
    expect(out.showAssignExec).toBe(true);
    expect(out.showAdvance).toBe(false);
    // Captain can still reject a spam/bad-quality submission without
    // assigning first; HVA-69 path stays open.
    expect(out.showMarkRejected).toBe(true);
  });

  it('super_admin at SUBMITTED → showAssignExec true, showAdvance false', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      role: 'super_admin',
      userId: ADMIN_ID,
      currentStageCode: 'SUBMITTED',
      assignedExecUserId: null,
    });
    expect(out.showAssignExec).toBe(true);
    expect(out.showAdvance).toBe(false);
  });

  it('exec at SUBMITTED → showAssignExec false (cannot self-assign)', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      role: 'sales_executive',
      userId: EXEC_ID,
      currentStageCode: 'SUBMITTED',
      // At SUBMITTED, assignedExecUserId is null by definition.
      assignedExecUserId: null,
    });
    expect(out.showAssignExec).toBe(false);
    // showAdvance is also false: the exec isn't the assigned exec for
    // an as-yet-unassigned request, so isAssignedExec gates them out.
    expect(out.showAdvance).toBe(false);
  });

  it('captain at ASSIGNED → showAssignExec false; generic advance returns', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      role: 'captain',
      userId: CAPTAIN_ID,
      currentStageCode: 'ASSIGNED',
    });
    expect(out.showAssignExec).toBe(false);
    expect(out.showAdvance).toBe(true);
  });

  it('cancelled request → showAssignExec false (terminal short-circuit honored)', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      role: 'captain',
      userId: CAPTAIN_ID,
      currentStageCode: 'SUBMITTED',
      assignedExecUserId: null,
      cancelledAt: new Date(),
    });
    expect(out.showAssignExec).toBe(false);
  });
});

describe('computeActionVisibility — Mark Customer Rejected (HVA-69)', () => {
  it('assigned exec → showMarkRejected', () => {
    const out = computeActionVisibility(baseInput());
    expect(out.showMarkRejected).toBe(true);
  });

  it('other exec (NOT assigned) → hidden', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      userId: OTHER_USER_ID,
    });
    expect(out.showMarkRejected).toBe(false);
  });

  it('captain of city → visible', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      role: 'captain',
      userId: CAPTAIN_ID,
    });
    expect(out.showMarkRejected).toBe(true);
  });

  it('captain of DIFFERENT city → hidden', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      role: 'captain',
      userId: OTHER_USER_ID,
    });
    expect(out.showMarkRejected).toBe(false);
  });

  it('super_admin → visible (escape hatch)', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      role: 'super_admin',
      userId: ADMIN_ID,
    });
    expect(out.showMarkRejected).toBe(true);
  });

  it('hidden at terminal pipeline stage (ORDER_EXECUTED_SUCCESSFULLY)', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      currentStageCode: 'ORDER_EXECUTED_SUCCESSFULLY',
      hasNextStage: false,
    });
    expect(out.showMarkRejected).toBe(false);
  });
});

describe('computeActionVisibility — Mark Installation Complete (HVA-68)', () => {
  it('visible to assigned exec at INSTALLATION_SCHEDULED', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      currentStageCode: 'INSTALLATION_SCHEDULED',
    });
    expect(out.showMarkComplete).toBe(true);
  });

  it('visible to assigned exec at INSTALLATION_CONFIGURATION_DONE', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      currentStageCode: 'INSTALLATION_CONFIGURATION_DONE',
    });
    expect(out.showMarkComplete).toBe(true);
  });

  it('hidden at any other stage (e.g. VISIT_SCHEDULED)', () => {
    const out = computeActionVisibility(baseInput());
    expect(out.showMarkComplete).toBe(false);
  });

  it('hidden to captain (even at the right stage — exec/admin only)', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      role: 'captain',
      userId: CAPTAIN_ID,
      currentStageCode: 'INSTALLATION_SCHEDULED',
    });
    expect(out.showMarkComplete).toBe(false);
  });

  it('visible to super_admin at INSTALLATION_SCHEDULED', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      role: 'super_admin',
      userId: ADMIN_ID,
      currentStageCode: 'INSTALLATION_SCHEDULED',
    });
    expect(out.showMarkComplete).toBe(true);
  });
});

describe('computeActionVisibility — Generic Advance (HVA-104)', () => {
  it('visible to assigned exec at VISIT_SCHEDULED', () => {
    const out = computeActionVisibility(baseInput());
    expect(out.showAdvance).toBe(true);
  });

  it('hidden to captain at SUBMITTED (HVA-139 — Assign Exec replaces it)', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      role: 'captain',
      userId: CAPTAIN_ID,
      currentStageCode: 'SUBMITTED',
      assignedExecUserId: null,
    });
    expect(out.showAdvance).toBe(false);
  });

  it('hidden to super_admin at SUBMITTED (HVA-139 — same)', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      role: 'super_admin',
      userId: ADMIN_ID,
      currentStageCode: 'SUBMITTED',
      assignedExecUserId: null,
    });
    expect(out.showAdvance).toBe(false);
  });

  it('hidden to exec at PENDING_CAPTAIN_APPROVAL (HVA-68 gate)', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      currentStageCode: 'PENDING_CAPTAIN_APPROVAL',
    });
    expect(out.showAdvance).toBe(false);
  });

  it('visible to captain at PENDING_CAPTAIN_APPROVAL (next actor)', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      role: 'captain',
      userId: CAPTAIN_ID,
      currentStageCode: 'PENDING_CAPTAIN_APPROVAL',
    });
    expect(out.showAdvance).toBe(true);
  });

  it('visible to super_admin at PENDING_CAPTAIN_APPROVAL (escape hatch)', () => {
    const out = computeActionVisibility({
      ...baseInput(),
      role: 'super_admin',
      userId: ADMIN_ID,
      currentStageCode: 'PENDING_CAPTAIN_APPROVAL',
    });
    expect(out.showAdvance).toBe(true);
  });
});

describe('terminalBadgeMeta — actor-aware title + label', () => {
  it("'customer' → cancelled-by-customer title (HVA-39 path)", () => {
    expect(terminalBadgeMeta('customer')).toEqual({
      title: 'Customer cancelled — request closed',
      markedByLabel: 'Customer',
    });
  });

  it("'exec' → customer-rejected title with Sales executive label (HVA-69 path)", () => {
    expect(terminalBadgeMeta('exec')).toEqual({
      title: 'Customer rejected — request closed',
      markedByLabel: 'Sales executive',
    });
  });

  it("'captain' → customer-rejected title with Captain label", () => {
    expect(terminalBadgeMeta('captain')).toEqual({
      title: 'Customer rejected — request closed',
      markedByLabel: 'Captain',
    });
  });

  it("'admin' → customer-rejected title with Admin label", () => {
    expect(terminalBadgeMeta('admin')).toEqual({
      title: 'Customer rejected — request closed',
      markedByLabel: 'Admin',
    });
  });

  it('null actor → defensive default', () => {
    expect(terminalBadgeMeta(null)).toEqual({
      title: 'Request closed',
      markedByLabel: '—',
    });
  });
});
