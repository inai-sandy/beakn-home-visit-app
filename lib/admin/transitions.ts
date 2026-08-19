import { and, asc, eq } from 'drizzle-orm';
import { cache } from 'react';

import { db } from '@/db/client';
import { statusStages, statusTransitions } from '@/db/schema';
import { alias } from 'drizzle-orm/pg-core';

// =============================================================================
// HVA-223: loaders for the status_transitions catalog
// =============================================================================
//
// Two consumers:
//   - /admin/settings/workflow/transitions — admin grid view + edit
//   - <AdvanceStatusButton> — reads `requires_datetime` to decide whether
//     to open the calendar dialog (replaces hardcoded VISIT_SCHEDULED check)
//
// loadTransitionByPair() is wrapped in React's `cache()` so the per-request
// detail page (which renders the button for the NEXT stage) doesn't pay
// twice when called from multiple components.
// =============================================================================

export interface TransitionRow {
  id: string;
  fromStageId: string;
  fromCode: string;
  fromName: string;
  fromSequence: number;
  toStageId: string;
  toCode: string;
  toName: string;
  toSequence: number;
  kind: string;
  allowedRole: string;
  requiresReason: boolean;
  requiresQuotation: boolean;
  requiresDatetime: boolean;
  autoTaskType: string | null;
  emitsEvent: string | null;
  description: string | null;
  isActive: boolean;
  /** HVA-341: an integration owns this transition; humans are refused
   *  (super_admin excepted). Read-only in the admin grid — see
   *  db/migrations/0091. */
  systemOnly: boolean;
}

export async function loadAllTransitions(): Promise<TransitionRow[]> {
  const fromStage = alias(statusStages, 'from_stage');
  const toStage = alias(statusStages, 'to_stage');

  return db
    .select({
      id: statusTransitions.id,
      fromStageId: statusTransitions.fromStageId,
      fromCode: fromStage.code,
      fromName: fromStage.name,
      fromSequence: fromStage.sequenceNumber,
      toStageId: statusTransitions.toStageId,
      toCode: toStage.code,
      toName: toStage.name,
      toSequence: toStage.sequenceNumber,
      kind: statusTransitions.kind,
      allowedRole: statusTransitions.allowedRole,
      requiresReason: statusTransitions.requiresReason,
      requiresQuotation: statusTransitions.requiresQuotation,
      requiresDatetime: statusTransitions.requiresDatetime,
      autoTaskType: statusTransitions.autoTaskType,
      emitsEvent: statusTransitions.emitsEvent,
      description: statusTransitions.description,
      isActive: statusTransitions.isActive,
      systemOnly: statusTransitions.systemOnly,
    })
    .from(statusTransitions)
    .innerJoin(fromStage, eq(fromStage.id, statusTransitions.fromStageId))
    .innerJoin(toStage, eq(toStage.id, statusTransitions.toStageId))
    .orderBy(asc(fromStage.sequenceNumber), asc(toStage.sequenceNumber));
}

/** Cached lookup by (fromCode, toCode) pair. Returns null if no row
 *  exists (transition not seeded — should not happen in practice but
 *  defensive default = false on requires_datetime).
 *
 *  HVA-341: also returns `systemOnly`. Unlike the others it does NOT hide
 *  the control — the page turns it into a disabled button carrying the
 *  reason, because a step that silently disappears is what produced the
 *  "it was there before, now it's gone" reports.
 *
 *  HVA-310: now also returns `allowedRole` and `requiresReason`. The engine
 *  (lib/status-transition.ts) has always enforced both, but the request
 *  detail page never read them, so the UI offered buttons the server would
 *  reject — and hid nothing when an admin disabled a transition. */
export const loadTransitionByPair = cache(
  async (
    fromCode: string,
    toCode: string,
  ): Promise<{
    requiresDatetime: boolean;
    isActive: boolean;
    allowedRole: string;
    requiresReason: boolean;
    requiresQuotation: boolean;
    systemOnly: boolean;
    autoTaskType: string | null;
    emitsEvent: string | null;
  } | null> => {
    const fromStage = alias(statusStages, 'from_stage');
    const toStage = alias(statusStages, 'to_stage');

    const [row] = await db
      .select({
        requiresDatetime: statusTransitions.requiresDatetime,
        isActive: statusTransitions.isActive,
        allowedRole: statusTransitions.allowedRole,
        requiresReason: statusTransitions.requiresReason,
        requiresQuotation: statusTransitions.requiresQuotation,
        systemOnly: statusTransitions.systemOnly,
        autoTaskType: statusTransitions.autoTaskType,
        emitsEvent: statusTransitions.emitsEvent,
      })
      .from(statusTransitions)
      .innerJoin(fromStage, eq(fromStage.id, statusTransitions.fromStageId))
      .innerJoin(toStage, eq(toStage.id, statusTransitions.toStageId))
      .where(and(eq(fromStage.code, fromCode), eq(toStage.code, toCode)))
      .limit(1);

    return row ?? null;
  },
);
