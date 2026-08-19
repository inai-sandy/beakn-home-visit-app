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
  /** HVA-310: the `status_transitions` row for current → next stage.
   * `null` = the pair isn't configured, which the engine answers with
   * FORWARD_ONLY, so the button must not render. Omitted entirely = the
   * caller predates this field; treated as permissive so this helper never
   * hides a button the engine would have allowed. */
  nextTransition?: TransitionGate | null;
  /** HVA-310: the `status_transitions` row for current → previous stage,
   * i.e. the rollback pair. Same null/undefined semantics as above. */
  previousTransition?: TransitionGate | null;
  /** HVA-321: whether the acting captain owns this request, per the single
   * predicate in `lib/captain/request-scope.ts` — they accepted it, the
   * assigned exec reports to them, or they own the city.
   *
   * Omitting it falls back to the old city-only check, so existing call sites
   * and tests keep their exact meaning. The page supplies it. Without it, a
   * captain who reached the page via either of the other two access paths saw
   * the request and NO action buttons — the "it was there before, now it's
   * gone" report. */
  captainOwnsRequest?: boolean;
}

/**
 * The parts of a `status_transitions` row that decide whether a button may
 * render. Deliberately a subset — this helper stays pure and has no need
 * for the rest of the row.
 */
export interface TransitionGate {
  /** 'any' | 'sales_executive' | 'captain' | 'super_admin'. This is a free
   * varchar in the DB with no CHECK constraint, so an unrecognised value
   * falls through to "super_admin only" — exactly what the engine does. */
  allowedRole: string;
  isActive: boolean;
  // NOTE: `system_only` (HVA-341) is deliberately NOT part of this gate.
  // Every field here HIDES the control; system_only must leave it visible
  // and disabled with a reason, which the page handles via
  // `advanceBlockedReason`. Adding it here would make the button vanish.
}

/**
 * Mirror of the engine's role check in lib/status-transition.ts:
 *
 *   actorRole !== SUPER_ADMIN && allowedRole !== 'any' && allowedRole !== actorRole
 *     → 403 ROLE_NOT_ALLOWED
 *
 * Kept deliberately identical. When these two disagree the UI either offers
 * an action the server refuses (a dead button and a 403 toast) or hides one
 * the server would accept (a feature that silently vanishes) — the failure
 * mode HVA-310 exists to remove. The conformance test asserts they agree
 * for every row in `status_transitions`.
 */
function roleSatisfies(allowedRole: string, role: Role | undefined): boolean {
  if (role === USER_ROLES.SUPER_ADMIN) return true;
  if (allowedRole === 'any') return true;
  return allowedRole === role;
}

function transitionPermits(
  gate: TransitionGate | null | undefined,
  role: Role | undefined,
): boolean {
  if (gate === undefined) return true;
  if (gate === null) return false;
  if (!gate.isActive) return false;
  return roleSatisfies(gate.allowedRole, role);
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
  /** HVA-140 Reassign Exec — captain-of-city / super_admin at any
   * post-Submitted, non-terminal, non-cancelled stage where an exec is
   * currently assigned. Status stage does NOT change on reassignment;
   * the flow continues from where the previous exec left off. */
  showReassign: boolean;
  /** HVA-137 Approve & complete — captain-of-city / super_admin at
   * PENDING_CAPTAIN_APPROVAL. Advances the request forward to
   * ORDER_EXECUTED_SUCCESSFULLY via /api/requests/[id]/approve. */
  showApprove: boolean;
  /** HVA-137 Request changes (reject) — captain-of-city / super_admin
   * at PENDING_CAPTAIN_APPROVAL. Sends the request back to
   * INSTALLATION_SCHEDULED via /api/requests/[id]/reject with a
   * mandatory 50–500 char reason. */
  showReject: boolean;
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
      showReassign: false,
      showApprove: false,
      showReject: false,
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
      showReassign: false,
      showApprove: false,
      showReject: false,
    };
  }

  const isAssignedExec =
    input.role === USER_ROLES.SALES_EXECUTIVE &&
    input.assignedExecUserId === input.userId;
  // HVA-321: "is this the captain for this request" — one definition, matching
  // the page's access rule (lib/captain/request-scope.ts). The old check was
  // city-only, so a captain who accepted the request, or whose exec is on the
  // request, could open it and see nothing actionable.
  //
  // `captainOwnsRequest` is resolved by the page (it needs a team lookup, and
  // this helper is pure). Falling back to the city check when it is absent
  // keeps every existing caller and test behaving exactly as before.
  const isCityCaptain =
    input.role === USER_ROLES.CAPTAIN &&
    (input.captainOwnsRequest ?? input.cityCaptainUserId === input.userId);
  const isAdmin = input.role === USER_ROLES.SUPER_ADMIN;

  const isPendingCaptainApproval =
    input.currentStageCode === 'PENDING_CAPTAIN_APPROVAL';

  // HVA-69 + HVA-137: rejected button — assigned exec OR captain of city
  // OR admin. Hidden at ORDER_EXECUTED_SUCCESSFULLY (already terminal)
  // and HIDDEN AT PENDING_CAPTAIN_APPROVAL for ALL roles — the captain
  // owns the decision there; exec must not terminate the customer with
  // the captain's approval pending.
  const showMarkRejected =
    input.currentStageCode !== 'ORDER_EXECUTED_SUCCESSFULLY' &&
    !isPendingCaptainApproval &&
    (isAdmin || isAssignedExec || isCityCaptain);

  // HVA-68: mark complete — only INSTALLATION_* stages; assigned exec OR admin.
  const showMarkComplete =
    (input.currentStageCode === 'INSTALLATION_SCHEDULED' ||
      input.currentStageCode === 'INSTALLATION_CONFIGURATION_DONE') &&
    (isAdmin || isAssignedExec);

  // HVA-137: nobody uses the generic Advance button at PENDING_CAPTAIN_APPROVAL.
  // Exec was already blocked here by the previous HVA-68 gate; captain/admin
  // now use the dedicated Approve / Reject buttons instead. Generic
  // /status route also returns WRONG_ROUTE for this stage.
  const hideGenericAtPendingApproval = isPendingCaptainApproval;

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
  //   - PENDING_CAPTAIN_APPROVAL for all roles (HVA-137 — Approve/Reject
  //     replace it; the previous HVA-68 gate covered exec only)
  //   - captain/admin at SUBMITTED (HVA-139 — Assign Exec takes over)
  //   - HVA-310: whatever `status_transitions` says about this pair. The
  //     engine enforces allowed_role and is_active; before this the page
  //     loaded the row for `requires_datetime` alone and discarded the rest,
  //     so an admin disabling a transition left a live button that 400s.
  const isEligibleForAdvance = isAdmin || isAssignedExec || isCityCaptain;
  const showAdvance =
    isEligibleForAdvance &&
    !hideGenericAtPendingApproval &&
    !hideGenericAtSubmittedForCaptainOrAdmin &&
    transitionPermits(input.nextTransition, input.role);

  // HVA-141: rollback is allowed at any non-SUBMITTED, non-PENDING_CAPTAIN_APPROVAL,
  // non-terminal stage, for the assigned exec, the city captain, or super_admin.
  // PENDING_CAPTAIN_APPROVAL has its own Reject path. SUBMITTED has nothing
  // to roll back to (hasPreviousStage gates that case as a defence too).
  // Terminal cancellation is already short-circuited above.
  //
  // HVA-310: the role set below is the *page's* rule about who may ever see
  // a rollback control. It is now intersected with the transition's own
  // `allowed_role` / `is_active`, which the engine enforces and this helper
  // previously ignored entirely. That mattered the moment a rollback was
  // scoped to super_admin: without this, captain and exec kept seeing the
  // button and got a 403 on click.
  //
  // The PENDING_CAPTAIN_APPROVAL hard stop stays. It agrees with
  // rollback/route.ts step 5, and the DB row that contradicts it is dead
  // config being deactivated in HVA-313 — the fix belongs in the data, not
  // in un-hiding a button the route refuses.
  const isAtRollbackHardStop =
    isSubmitted || input.currentStageCode === 'PENDING_CAPTAIN_APPROVAL';
  const showRollback =
    !isAtRollbackHardStop &&
    input.hasPreviousStage &&
    (isAdmin || isAssignedExec || isCityCaptain) &&
    transitionPermits(input.previousTransition, input.role);

  // HVA-140: Reassign Exec — captain-of-city / super_admin at any stage
  // where an exec is currently assigned. The action carries operational
  // weight (affects two execs + customer perception), so we require an
  // exec to actually be on the request before offering it.
  // Cancellation + terminal are already short-circuited above.
  const showReassign =
    input.currentStageCode !== 'SUBMITTED' &&
    input.assignedExecUserId !== null &&
    (isAdmin || isCityCaptain);

  // HVA-137: Approve / Reject — captain-of-city / super_admin at
  // PENDING_CAPTAIN_APPROVAL. The exec at this stage sees only the
  // informational "Waiting for {captainName}" section; everything
  // actionable is hidden (showAdvance / showMarkRejected / showRollback
  // all false above).
  const showApprove =
    isPendingCaptainApproval && (isAdmin || isCityCaptain);
  const showReject = showApprove;

  return {
    showMarkRejected,
    showMarkComplete,
    showAdvance,
    showAssignExec,
    showRollback,
    showReassign,
    showApprove,
    showReject,
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
