import { USER_ROLES, type Role } from '@/lib/auth/roles';

// =============================================================================
// HVA-66: pure helpers for /requests/[id] page rendering
// =============================================================================
//
// The page itself stays a server component for SSR + per-row authz, but the
// derivation logic (which buttons to show, how to label the terminal-state
// card, how to format an IST date) lives here so it's unit-testable without
// React Testing Library.
//
// Visibility logic intentionally mirrors what the page does today —
// extracting it shouldn't change behavior, just expose it.
// =============================================================================

// -----------------------------------------------------------------------------
// IST date formatting — used for "Submitted at" + history timestamps.
// -----------------------------------------------------------------------------
//
// Beakn is India-only (Phase 1). Backend stores everything in UTC; surfacing
// IST on the customer-/exec-facing page matches what operators expect.
// `Intl.DateTimeFormat` with timeZone='Asia/Kolkata' gives us the conversion
// without pulling in moment-timezone or similar.
const IST_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/**
 * Format a Date or ISO string as 'DD MMM YYYY, hh:mm AM/PM IST'. Returns
 * null when the input is null/undefined so callers can skip rendering.
 */
export function formatIstDateTime(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return `${IST_FORMATTER.format(d)} IST`;
}

// -----------------------------------------------------------------------------
// Action button visibility — single source of truth, mirroring the page.
// -----------------------------------------------------------------------------

export interface ActionVisibilityInput {
  /** Actor's role. Captain/exec/super_admin. */
  role: Role | undefined;
  /** Acting user id (for per-row ownership checks). */
  userId: string;
  /** Current stage code (e.g. INSTALLATION_SCHEDULED). */
  currentStageCode: string;
  /** visit_requests.assigned_exec_user_id. */
  assignedExecUserId: string | null;
  /** cities.captain_user_id for the request's city. */
  cityCaptainUserId: string | null;
  /** visit_requests.cancelled_at — non-null means terminal-rejected. */
  cancelledAt: Date | null;
  /** Whether a forward "next stage" exists (false at terminal stages). */
  hasNextStage: boolean;
  /** HVA-141: whether a previous active stage exists (false at SUBMITTED).
   * Passed from the page so the helper doesn't have to know about the
   * status_stages query shape. */
  hasPreviousStage: boolean;
}

export interface ActionVisibility {
  /** HVA-69 Mark Customer Rejected — destructive terminal. */
  showMarkRejected: boolean;
  /** HVA-68 Mark Installation Complete — INSTALLATION_* stages only. */
  showMarkComplete: boolean;
  /** HVA-104 generic next-stage button. Hidden when sales_exec at
   * PENDING_CAPTAIN_APPROVAL (HVA-68 captain-approval gate), and at
   * SUBMITTED for captain/admin (HVA-139 — must go through the dedicated
   * Assign Sales Executive flow instead, which atomically sets the exec
   * id + advances the stage). */
  showAdvance: boolean;
  /** HVA-139 Assign Sales Executive — captain-of-city / admin at SUBMITTED.
   * Opens the shared AssignRequestModal that posts to /api/requests/[id]/assign. */
  showAssignExec: boolean;
  /** HVA-141 Rollback to previous stage — assigned exec / captain-of-city /
   * super_admin at any non-SUBMITTED, non-terminal, non-PENDING_CAPTAIN_APPROVAL
   * stage. PENDING_CAPTAIN_APPROVAL has its own Reject path; SUBMITTED and
   * terminal stages have nothing to roll back to. */
  showRollback: boolean;
}

/**
 * Compute which of the three action buttons should render for the given
 * actor + request state. Returns all-false when the request is terminal.
 */
export function computeActionVisibility(
  input: ActionVisibilityInput,
): ActionVisibility {
  // Terminal-state requests have no actionable buttons.
  if (input.cancelledAt !== null) {
    return {
      showMarkRejected: false,
      showMarkComplete: false,
      showAdvance: false,
      showAssignExec: false,
      showRollback: false,
    };
  }
  // No next stage = at terminal pipeline state (ORDER_EXECUTED_SUCCESSFULLY).
  if (!input.hasNextStage) {
    return {
      showMarkRejected: false,
      showMarkComplete: false,
      showAdvance: false,
      showAssignExec: false,
      showRollback: false,
    };
  }

  const isAssignedExec =
    input.role === USER_ROLES.SALES_EXECUTIVE &&
    input.assignedExecUserId === input.userId;
  const isCityCaptain =
    input.role === USER_ROLES.CAPTAIN &&
    input.cityCaptainUserId === input.userId;
  const isAdmin = input.role === USER_ROLES.SUPER_ADMIN;

  // HVA-69: rejected button — assigned exec OR captain of city OR admin.
  const showMarkRejected =
    input.currentStageCode !== 'ORDER_EXECUTED_SUCCESSFULLY' &&
    (isAdmin || isAssignedExec || isCityCaptain);

  // HVA-68: mark complete — only INSTALLATION_* stages; assigned exec OR admin.
  const showMarkComplete =
    (input.currentStageCode === 'INSTALLATION_SCHEDULED' ||
      input.currentStageCode === 'INSTALLATION_CONFIGURATION_DONE') &&
    (isAdmin || isAssignedExec);

  // HVA-68 gate: exec at PENDING_CAPTAIN_APPROVAL must wait for captain.
  const hideGenericForExecAtPendingApproval =
    input.currentStageCode === 'PENDING_CAPTAIN_APPROVAL' &&
    input.role === USER_ROLES.SALES_EXECUTIVE;

  // HVA-139: at SUBMITTED, captain + admin must go through the dedicated
  // Assign Sales Executive flow (which atomically sets the exec id +
  // advances the stage via /api/requests/[id]/assign). Hide the generic
  // "Move to Assigned" button for them; show showAssignExec instead.
  const isSubmitted = input.currentStageCode === 'SUBMITTED';
  const hideGenericAtSubmittedForCaptainOrAdmin =
    isSubmitted && (isAdmin || isCityCaptain);

  // HVA-139: Assign Sales Executive — captain-of-city / admin at SUBMITTED.
  // Execs never see this; they're not yet assigned and can't self-assign.
  const showAssignExec = isSubmitted && (isAdmin || isCityCaptain);

  // Advance button visibility: any of the three eligible roles, EXCEPT:
  //   - exec at PENDING_CAPTAIN_APPROVAL (HVA-68 gate)
  //   - captain/admin at SUBMITTED (HVA-139 — Assign Exec takes over)
  const isEligibleForAdvance = isAdmin || isAssignedExec || isCityCaptain;
  const showAdvance =
    isEligibleForAdvance &&
    !hideGenericForExecAtPendingApproval &&
    !hideGenericAtSubmittedForCaptainOrAdmin;

  // HVA-141: rollback is allowed at any non-SUBMITTED, non-PENDING_CAPTAIN_APPROVAL,
  // non-terminal stage, for the assigned exec, the city captain, or super_admin.
  // PENDING_CAPTAIN_APPROVAL has its own Reject path. SUBMITTED has nothing
  // to roll back to (hasPreviousStage gates that case as a defence too).
  // Terminal cancellation is already short-circuited above.
  const isAtRollbackHardStop =
    isSubmitted || input.currentStageCode === 'PENDING_CAPTAIN_APPROVAL';
  const showRollback =
    !isAtRollbackHardStop &&
    input.hasPreviousStage &&
    (isAdmin || isAssignedExec || isCityCaptain);

  return {
    showMarkRejected,
    showMarkComplete,
    showAdvance,
    showAssignExec,
    showRollback,
  };
}

// -----------------------------------------------------------------------------
// Terminal-state badge — label + tone vary by actor.
// -----------------------------------------------------------------------------

export type TerminalActor = 'customer' | 'exec' | 'captain' | 'admin' | null;

export interface TerminalBadgeMeta {
  /** Card title — varies by who marked the terminal state. */
  title: string;
  /** Short "Marked by" descriptor for the dl row. */
  markedByLabel: string;
}

/**
 * Pick the right card title + actor label based on cancellation_actor.
 * - 'customer' → HVA-39 customer-initiated cancellation
 * - 'exec'/'captain'/'admin' → HVA-69 staff-marked rejection (Phase 1
 *   refers to all three as "marked by exec/captain/admin"; future
 *   payments/refund flow may differentiate)
 * - null → unknown (defensive default, shouldn't happen when
 *   cancelled_at is set)
 */
export function terminalBadgeMeta(actor: TerminalActor): TerminalBadgeMeta {
  if (actor === 'customer') {
    return {
      title: 'Customer cancelled — request closed',
      markedByLabel: 'Customer',
    };
  }
  if (actor === 'exec') {
    return {
      title: 'Customer rejected — request closed',
      markedByLabel: 'Sales executive',
    };
  }
  if (actor === 'captain') {
    return {
      title: 'Customer rejected — request closed',
      markedByLabel: 'Captain',
    };
  }
  if (actor === 'admin') {
    return {
      title: 'Customer rejected — request closed',
      markedByLabel: 'Admin',
    };
  }
  return {
    title: 'Request closed',
    markedByLabel: '—',
  };
}
