import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { db } from '@/db/client';
import {
  cities,
  quotationLineItems,
  quotations,
  requestStatusHistory,
  statusStages,
  statusTransitions,
  users,
  visitRequests,
} from '@/db/schema';
import { dispatchNotification } from '@/lib/notifications/engine';
import { logEvent } from '@/lib/audit';
import { USER_ROLES, type Role } from '@/lib/auth/roles';
import { log } from '@/lib/logger';

// =============================================================================
// HVA-67 + HVA-81: shared status-transition service
// =============================================================================
//
// Extracted from app/api/requests/[id]/status/route.ts during HVA-81 so the
// /assign route can run the forward-only validation + status update inside
// the same DB transaction as the assignment writes — without HTTP self-
// calling another route handler.
//
// CONTRACT:
//   transitionRequestStatus({requestId, nextStatusId, actorUserId,
//                            actorRole, reason?, ipAddress?, userAgent?,
//                            preUpdate?})
//     → { ok: true, previous, current }
//     → { ok: false, status, error, ... }
//
// preUpdate is an optional hook that runs INSIDE the transaction, BEFORE
// the status update. HVA-81 uses it to set assigned_exec_user_id +
// assigned_captain_user_id + assigned_at atomically with the
// Submitted→Assigned transition. Throws inside preUpdate roll back the
// whole transition.
//
// The audit log call happens AFTER the transaction commits — logEvent
// is a fire-and-forget contract (HVA-18, never throws), so it has its
// own connection and shouldn't be wrapped in the caller's tx.
// =============================================================================

/**
 * HVA-341: stamped on the history + audit row when a super_admin takes a
 * `system_only` transition by hand. Without it, an order confirmed manually
 * during a webhook outage is indistinguishable from one CartPlus confirmed,
 * and "who decided this order was real?" has no answer.
 */
export const SYSTEM_ONLY_OVERRIDE_REASON =
  'SUPER_ADMIN_OVERRIDE: advanced manually; CartPlus did not confirm this order';

export type StatusTransitionError =
  | { ok: false; status: 404; error: 'REQUEST_NOT_FOUND'; message: string }
  | { ok: false; status: 400; error: 'STAGE_NOT_FOUND'; message: string }
  | { ok: false; status: 400; error: 'STAGE_INACTIVE'; message: string }
  | { ok: false; status: 400; error: 'TERMINAL_STAGE'; message: string }
  | {
      ok: false;
      status: 400;
      error: 'FORWARD_ONLY';
      message: string;
      currentSequence: number;
      attemptedSequence: number;
    }
  // HVA-225 — admin disabled this transition via /admin/settings/workflow/transitions.
  | {
      ok: false;
      status: 400;
      error: 'TRANSITION_INACTIVE';
      message: string;
    }
  // HVA-225 — admin set allowed_role on the transition; actor doesn't match.
  | {
      ok: false;
      status: 403;
      error: 'ROLE_NOT_ALLOWED';
      message: string;
      requiredRole: string;
    }
  // HVA-341 — the transition is owned by an integration, not a person.
  // super_admin bypasses this; everyone else is refused.
  | {
      ok: false;
      status: 403;
      error: 'SYSTEM_ONLY';
      message: string;
    }
  // HVA-225 — admin set requires_reason=true; advance had empty/null reason.
  | {
      ok: false;
      status: 400;
      error: 'REASON_REQUIRED';
      message: string;
    }
  // HVA-225 — admin set requires_quotation=true; request has no quotation row.
  | {
      ok: false;
      status: 400;
      error: 'QUOTATION_REQUIRED';
      message: string;
    }
  // HVA-317 — transition needs a picked date; caller must use the scheduling
  // dialog (scheduleVisitAction), not the plain advance.
  | {
      ok: false;
      status: 400;
      error: 'DATETIME_REQUIRED';
      message: string;
    }
  | { ok: false; status: 503; error: 'TX_FAILED'; message: string };

export interface StageRef {
  id: string;
  name: string;
  sequenceNumber: number;
}

export interface StatusTransitionSuccess {
  ok: true;
  previous: StageRef;
  current: StageRef;
}

// drizzle's transaction callback receives a PgTransaction. Extract it from
// the db.transaction type so the public API stays a structural reference
// (no need to import the underlying type, which varies by driver).
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface TransitionInput {
  requestId: string;
  nextStatusId: string;
  actorUserId: string;
  actorRole: Role;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  /**
   * Optional hook run INSIDE the transaction, BEFORE the status update.
   * Use for related writes that must commit atomically with the status
   * change — e.g. HVA-81 sets assigned_exec_user_id here so the
   * Submitted→Assigned transition is paired with the exec assignment
   * in a single tx.
   */
  preUpdate?: (tx: DbTx) => Promise<void>;
  /**
   * HVA-68: opt-in escape hatch from the strict +1 rule. When true, any
   * forward target stage is accepted (still `nextSeq > currentSeq`) —
   * skipping intermediate stages is allowed. Backward and same-stage
   * transitions are still rejected.
   *
   * Used by /api/requests/[id]/mark-installation-complete so an exec
   * standing at "Installation Scheduled" (seq 7) can jump directly to
   * "Pending Captain Approval" (seq 9), recording that intermediate
   * "Installation & Configuration Done" was implicitly completed by
   * the act of marking the whole installation done.
   *
   * Default `false` preserves the +1 invariant for every other caller
   * (the generic "Move to Next Stage" button + HVA-81 assign).
   */
  allowForwardSkip?: boolean;
  /**
   * HVA-141: opt-in to a SINGLE backward step (nextSeq === currentSeq - 1).
   * Used by /api/requests/[id]/rollback. Multi-stage rollback is not
   * supported — callers wanting more than one step back must invoke the
   * rollback route N times.
   *
   * Default `false` preserves the forward-only invariant for every
   * other caller.
   */
  allowRollback?: boolean;
  /**
   * HVA-137: narrow opt-in for a SPECIFIC named backward transition pair
   * (currentStageCode → nextStageCode). The validator accepts the
   * transition only when BOTH ends match exactly. Used by
   * /api/requests/[id]/reject to permit the multi-stage backward jump
   * PENDING_CAPTAIN_APPROVAL → INSTALLATION_SCHEDULED (seq 9 → 6) that
   * `allowRollback` (single step only) and `allowForwardSkip` (forward
   * only) cannot cover. Strictly narrower than a general "allow any
   * backward" footgun: every other arbitrary pair stays rejected.
   *
   * Default `undefined` preserves the forward-only invariant for every
   * other caller.
   */
  allowSpecificBackwardTransition?: { fromCode: string; toCode: string };
}

const transitionLog = log.child({ component: 'status-transition' });

export async function transitionRequestStatus(
  input: TransitionInput,
): Promise<StatusTransitionSuccess | StatusTransitionError> {
  const {
    requestId,
    nextStatusId,
    actorUserId,
    actorRole,
    reason,
    ipAddress,
    userAgent,
    preUpdate,
    allowForwardSkip = false,
    allowRollback = false,
    allowSpecificBackwardTransition,
  } = input;

  // 1. Load current request + its current stage (join). HVA-137 added
  //    currentStageCode so the validator can match the new
  //    `allowSpecificBackwardTransition` option's `fromCode`.
  const [currentRow] = await db
    .select({
      requestId: visitRequests.id,
      currentStageId: visitRequests.statusStageId,
      currentStageCode: statusStages.code,
      currentStageSeq: statusStages.sequenceNumber,
      currentStageName: statusStages.name,
      // 2026-05-30: customer + city + captain for the
      // request.pending_approval dispatch below.
      customerName: visitRequests.customerName,
      cityId: visitRequests.cityId,
      cityName: cities.name,
      cityCaptainUserId: cities.captainUserId,
      // HVA-240: assigned_captain (separate from city's captain) for the
      // support.order_ready_for_dispatch + support.dispatch_recorded
      // fan-out — captain_owning_city + the directly-assigned captain
      // can differ (reassignment scenarios).
      assignedCaptainUserId: visitRequests.assignedCaptainUserId,
      // HVA-46/47: customer phone + tracking token for WhatsApp template
      // dispatches on QUOTATION_SUBMITTED / ORDER_CONFIRMED /
      // INSTALLATION_COMPLETE transitions.
      customerPhone: visitRequests.customerPhone,
      trackingToken: visitRequests.trackingToken,
      // HVA-79: customer opt-in flag, threaded into dispatch context so
      // the engine's `customer` resolver can short-circuit WhatsApp.
      whatsappOptIn: visitRequests.whatsappOptIn,
      // HVA-49: exec name for the captain_pending_approval WhatsApp.
      assignedExecUserId: visitRequests.assignedExecUserId,
      execName: users.fullName,
    })
    .from(visitRequests)
    .innerJoin(statusStages, eq(statusStages.id, visitRequests.statusStageId))
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .leftJoin(users, eq(users.id, visitRequests.assignedExecUserId))
    .where(eq(visitRequests.id, requestId))
    .limit(1);

  if (!currentRow) {
    return {
      ok: false,
      status: 404,
      error: 'REQUEST_NOT_FOUND',
      message: 'Request not found',
    };
  }

  // 2. Load the proposed next stage.
  const [nextRow] = await db
    .select({
      id: statusStages.id,
      code: statusStages.code,
      name: statusStages.name,
      sequenceNumber: statusStages.sequenceNumber,
      isActive: statusStages.isActive,
    })
    .from(statusStages)
    .where(eq(statusStages.id, nextStatusId))
    .limit(1);

  if (!nextRow) {
    return {
      ok: false,
      status: 400,
      error: 'STAGE_NOT_FOUND',
      message: 'Target status stage not found',
    };
  }
  if (!nextRow.isActive) {
    return {
      ok: false,
      status: 400,
      error: 'STAGE_INACTIVE',
      message: 'Target status stage is inactive',
    };
  }

  // 3. Terminal check — dynamic MAX(sequence_number) on active stages.
  //    Admin-added stages extend the lifecycle without code changes.
  const [maxRow] = await db
    .select({ maxSeq: statusStages.sequenceNumber })
    .from(statusStages)
    .where(eq(statusStages.isActive, true))
    .orderBy(desc(statusStages.sequenceNumber))
    .limit(1);
  const maxSeq = maxRow?.maxSeq ?? 0;

  if (currentRow.currentStageSeq >= maxSeq) {
    return {
      ok: false,
      status: 400,
      error: 'TERMINAL_STAGE',
      message: `Already at the final stage (${currentRow.currentStageName}). Cannot transition further.`,
    };
  }

  // 4. HVA-225 — table-driven transition validation.
  //
  // Replaces the legacy flag-based validation (allowForwardSkip /
  // allowRollback / allowSpecificBackwardTransition). The engine now
  // consults `status_transitions` for every (fromCode, toCode) pair.
  //
  // Caller flags (allowForwardSkip / allowRollback / allowSpecificBackwardTransition)
  // are KEPT in the signature for back-compat but no longer affect
  // validation — every legal pair was seeded at migration 0060. If a
  // caller passes a flag for a pair that isn't in the table, the
  // transition is rejected via the standard TRANSITION_NOT_ALLOWED /
  // FORWARD_ONLY paths below.
  //
  // Note the cycle of validation:
  //   a) pair exists in table  →  if not, FORWARD_ONLY
  //   b) is_active = true       →  if not, TRANSITION_INACTIVE
  //   c) system_only            →  if set, SYSTEM_ONLY
  //   d) allowed_role           →  if not, ROLE_NOT_ALLOWED
  //   e) requires_reason        →  if reason empty, REASON_REQUIRED
  //   f) requires_quotation     →  if no quote row, QUOTATION_REQUIRED
  //
  // super_admin always bypasses (c) and (d).
  void allowForwardSkip;
  void allowRollback;
  void allowSpecificBackwardTransition;

  const fromStageAlias = alias(statusStages, 'from_stage_t');
  const toStageAlias = alias(statusStages, 'to_stage_t');
  const [transitionRow] = await db
    .select({
      id: statusTransitions.id,
      kind: statusTransitions.kind,
      allowedRole: statusTransitions.allowedRole,
      requiresReason: statusTransitions.requiresReason,
      requiresQuotation: statusTransitions.requiresQuotation,
      requiresDatetime: statusTransitions.requiresDatetime,
      autoTaskType: statusTransitions.autoTaskType,
      emitsEvent: statusTransitions.emitsEvent,
      isActive: statusTransitions.isActive,
      systemOnly: statusTransitions.systemOnly,
    })
    .from(statusTransitions)
    .innerJoin(
      fromStageAlias,
      eq(fromStageAlias.id, statusTransitions.fromStageId),
    )
    .innerJoin(
      toStageAlias,
      eq(toStageAlias.id, statusTransitions.toStageId),
    )
    .where(
      and(
        eq(fromStageAlias.code, currentRow.currentStageCode),
        eq(toStageAlias.code, nextRow.code),
      ),
    )
    .limit(1);

  if (!transitionRow) {
    return {
      ok: false,
      status: 400,
      error: 'FORWARD_ONLY',
      message: `Transition from ${currentRow.currentStageCode} to ${nextRow.code} is not configured. Ask admin to add it at /admin/settings/workflow/transitions.`,
      currentSequence: currentRow.currentStageSeq,
      attemptedSequence: nextRow.sequenceNumber,
    };
  }

  if (!transitionRow.isActive) {
    return {
      ok: false,
      status: 400,
      error: 'TRANSITION_INACTIVE',
      message: `Admin has disabled this transition (${currentRow.currentStageCode} → ${nextRow.code}). Ask admin to re-enable it at /admin/settings/workflow/transitions.`,
    };
  }

  // HVA-341: system_only — an integration owns this transition. Sandeep's
  // case is order confirmation: CartPlus decides whether an order is real,
  // and the portal must not let a person assert it independently.
  //
  // Checked AFTER is_active and BEFORE allowed_role so the refusal names the
  // actual reason. A person reading "this requires role X" would go asking
  // for role X; there is no role that unlocks this.
  //
  // super_admin passes through as the escape hatch for the day a webhook
  // never arrives — recorded below via SYSTEM_ONLY_OVERRIDE_REASON, so a
  // manual confirmation is never indistinguishable from a real one.
  if (transitionRow.systemOnly && actorRole !== USER_ROLES.SUPER_ADMIN) {
    return {
      ok: false,
      status: 403,
      error: 'SYSTEM_ONLY',
      message:
        'This step is set by CartPlus, not in the portal. Confirm the order in CartPlus and it will move here automatically.',
    };
  }

  const recordedReason =
    transitionRow.systemOnly && (reason ?? '').trim().length === 0
      ? SYSTEM_ONLY_OVERRIDE_REASON
      : (reason ?? null);

  // Role check — super_admin always allowed; `any` means everyone; else
  // actor's role must match the configured role.
  if (
    actorRole !== USER_ROLES.SUPER_ADMIN &&
    transitionRow.allowedRole !== 'any' &&
    transitionRow.allowedRole !== actorRole
  ) {
    return {
      ok: false,
      status: 403,
      error: 'ROLE_NOT_ALLOWED',
      message: `This transition requires role "${transitionRow.allowedRole}"; your role is "${actorRole}".`,
      requiredRole: transitionRow.allowedRole,
    };
  }

  if (transitionRow.requiresReason) {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length === 0) {
      return {
        ok: false,
        status: 400,
        error: 'REASON_REQUIRED',
        message: 'This transition requires a reason note.',
      };
    }
  }

  if (transitionRow.requiresQuotation) {
    const [quote] = await db
      .select({ id: quotations.id })
      .from(quotations)
      .where(eq(quotations.visitRequestId, requestId))
      .limit(1);
    if (!quote) {
      return {
        ok: false,
        status: 400,
        error: 'QUOTATION_REQUIRED',
        message:
          'This transition requires a quotation to be submitted first.',
      };
    }
  }

  // HVA-317: requires_datetime was selected by this function but never
  // enforced — its only reference was the SELECT above. So a transition
  // marked "needs a date" could still be advanced dateless through the
  // generic /status route, leaving the stage moved and nothing scheduled.
  // That is exactly the hole the installation stage sat in.
  //
  // Scheduling runs through scheduleVisitAction (which owns the picker, the
  // datetime write and the auto-task) and does NOT come back through here,
  // so reaching this point with requires_datetime on means the caller took
  // the wrong path.
  if (transitionRow.requiresDatetime) {
    return {
      ok: false,
      status: 400,
      error: 'DATETIME_REQUIRED',
      message:
        'This transition needs a date and time — use the scheduling dialog rather than the plain advance.',
    };
  }

  // 5. Single transaction:
  //    a) preUpdate(tx) — caller-supplied atomic side-effect, if any
  //    b) UPDATE visit_requests.status_stage_id
  //    c) INSERT request_status_history (UNIQUE on
  //       (request_id, sequence_number) — guards against concurrent
  //       double-transitions to the same stage)
  try {
    await db.transaction(async (tx) => {
      if (preUpdate) await preUpdate(tx);

      await tx
        .update(visitRequests)
        .set({ statusStageId: nextRow.id, updatedAt: new Date() })
        .where(eq(visitRequests.id, requestId));

      // HVA-141: transition_order is monotonic per request. The
      // subquery runs inside the same tx so concurrent writers are
      // serialised by the UNIQUE (request_id, transition_order) index
      // — a racing INSERT would fail with a unique violation, which
      // we catch as TX_FAILED below. sequence_number still tracks the
      // target stage's seq for backward compatibility + human-readable
      // queries.
      await tx.insert(requestStatusHistory).values({
        requestId,
        fromStatusStageId: currentRow.currentStageId,
        toStatusStageId: nextRow.id,
        sequenceNumber: nextRow.sequenceNumber,
        transitionOrder: sql`COALESCE((SELECT MAX(transition_order) FROM request_status_history WHERE request_id = ${requestId}), 0) + 1`,
        changedByUserId: actorUserId,
        reason: recordedReason,
      });
    });
  } catch (err) {
    transitionLog.error(
      {
        requestId,
        nextStatusId,
        err: err instanceof Error ? err.message : String(err),
      },
      'status_transition_tx_failed',
    );
    return {
      ok: false,
      status: 503,
      error: 'TX_FAILED',
      message: 'Service temporarily unavailable.',
    };
  }

  // 6. Audit row. logEvent never throws (HVA-18 contract); runs outside
  //    the tx because it owns its own connection.
  await logEvent({
    eventType: 'status_change',
    actorUserId,
    actorRole,
    targetEntityType: 'visit_request',
    targetEntityId: requestId,
    beforeState: {
      statusStageId: currentRow.currentStageId,
      sequenceNumber: currentRow.currentStageSeq,
      stageName: currentRow.currentStageName,
    },
    afterState: {
      statusStageId: nextRow.id,
      sequenceNumber: nextRow.sequenceNumber,
      stageName: nextRow.name,
    },
    reason: recordedReason,
    ipAddress: ipAddress ?? null,
    userAgent: userAgent ?? null,
  });

  // HVA-225 — table-driven event dispatch. The transition row's
  // `emits_event` field is the canonical source for which notification
  // event fires after a successful transition. Replaces the legacy
  // hardcoded customerStageEventMap + the PENDING_CAPTAIN_APPROVAL
  // dispatch.
  //
  // Context carries every field the existing event composers consume —
  // customer-facing events read customerPhone / trackingToken /
  // whatsappOptIn; admin/captain events read cityCaptainUserId /
  // execName. The notification engine routes by event_type → rules and
  // drops fields it doesn't need.
  const dispatchEventType = transitionRow.emitsEvent;
  if (dispatchEventType) {
    setImmediate(() => {
      dispatchNotification(dispatchEventType, {
        requestId,
        customerName: currentRow.customerName,
        customerPhone: currentRow.customerPhone,
        trackingToken: currentRow.trackingToken,
        customerWhatsappOptIn: currentRow.whatsappOptIn,
        cityName: currentRow.cityName,
        cityCaptainUserId: currentRow.cityCaptainUserId,
        execUserId: currentRow.assignedExecUserId,
        execName: currentRow.execName ?? 'A team member',
      }).catch((err) => {
        transitionLog.warn(
          {
            err: err instanceof Error ? err.message : String(err),
            requestId,
            event: dispatchEventType,
          },
          'transition_event_dispatch_failed',
        );
      });
    });
  } else {
    transitionLog.info(
      {
        requestId,
        fromSeq: currentRow.currentStageSeq,
        toSeq: nextRow.sequenceNumber,
      },
      'status_transition_no_dispatch_for_this_target',
    );
  }

  // HVA-240 (HVA-231 Phase 2 PR-C): notify the support team broadcast
  // when a request transitions INTO ORDER_CONFIRMED. Orthogonal to the
  // per-transition `emits_event` map above — that one fires on the
  // status_transitions row's configured event; this one is always tied
  // to landing in ORDER_CONFIRMED regardless of which transition led
  // there.
  if (nextRow.code === 'ORDER_CONFIRMED') {
    setImmediate(() => {
      void (async () => {
        try {
          let itemCount = 0;
          const [quoteRow] = await db
            .select({ id: quotations.id })
            .from(quotations)
            .where(eq(quotations.visitRequestId, requestId))
            .limit(1);
          if (quoteRow) {
            const itemsCountRow = await db
              .select({ count: sql<number>`COUNT(*)::int` })
              .from(quotationLineItems)
              .where(
                and(
                  eq(quotationLineItems.quotationId, quoteRow.id),
                  // HVA-340: this number tells support how much work is
                  // waiting. Items a CartPlus edit removed are not work.
                  isNull(quotationLineItems.removedAt),
                ),
              );
            itemCount = itemsCountRow[0]?.count ?? 0;
          }
          await dispatchNotification('support.order_ready_for_dispatch', {
            requestId,
            customerName: currentRow.customerName,
            cityName: currentRow.cityName,
            cityId: currentRow.cityId,
            cityCaptainUserId: currentRow.cityCaptainUserId,
            execUserId: currentRow.assignedExecUserId,
            captainUserId: currentRow.assignedCaptainUserId,
            itemCount,
          });
        } catch (err) {
          transitionLog.warn(
            {
              err: err instanceof Error ? err.message : String(err),
              requestId,
            },
            'order_confirmed_support_notification_failed',
          );
        }
      })();
    });
  }

  return {
    ok: true,
    previous: {
      id: currentRow.currentStageId,
      name: currentRow.currentStageName,
      sequenceNumber: currentRow.currentStageSeq,
    },
    current: {
      id: nextRow.id,
      name: nextRow.name,
      sequenceNumber: nextRow.sequenceNumber,
    },
  };
}
