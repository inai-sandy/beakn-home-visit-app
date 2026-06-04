import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import {
  auditLog,
  cities,
  requestStatusHistory,
  statusStages,
  users,
  visitRequests,
} from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { getConfig } from '@/lib/config';
import { log } from '@/lib/logger';
import { dispatchNotification } from '@/lib/notifications/engine';
import { alias } from 'drizzle-orm/pg-core';

// =============================================================================
// HVA-224: escalate-stale-approvals cron
// =============================================================================
//
// Finds every PENDING_CAPTAIN_APPROVAL visit_request whose most-recent
// transition INTO that stage is older than the admin-configured
// `pending_captain_approval_timeout_hours`. For each breached row, emits
// the `request.approval_overdue` event (notification engine fans out to
// admin per HVA-50 rules) + writes an `approval_escalated` audit row.
//
// Dedup: subsequent runs check whether an `approval_escalated` event
// already exists for the same request AFTER the breach started. If yes,
// skip — one escalation per breach window.
//
// Timeout = 0 disables the cron entirely (returns { escalated: 0, skipped: 0 }).
// =============================================================================

const cronLog = log.child({ component: 'cron.escalate-stale-approvals' });

export interface EscalateResult {
  thresholdHours: number;
  candidates: number;
  escalated: number;
  skippedAlreadyEscalated: number;
}

export async function escalateStaleApprovals(): Promise<EscalateResult> {
  const thresholdHours = await getConfig('pending_captain_approval_timeout_hours');
  if (thresholdHours <= 0) {
    cronLog.info({ thresholdHours }, 'escalation_disabled');
    return {
      thresholdHours,
      candidates: 0,
      escalated: 0,
      skippedAlreadyEscalated: 0,
    };
  }

  // Resolve the PENDING_CAPTAIN_APPROVAL stage id once.
  const [pendingStage] = await db
    .select({ id: statusStages.id })
    .from(statusStages)
    .where(eq(statusStages.code, 'PENDING_CAPTAIN_APPROVAL'))
    .limit(1);
  if (!pendingStage) {
    cronLog.warn('pending_captain_approval_stage_missing');
    return {
      thresholdHours,
      candidates: 0,
      escalated: 0,
      skippedAlreadyEscalated: 0,
    };
  }

  // Find every non-cancelled request currently in PENDING_CAPTAIN_APPROVAL
  // along with the changed_at of its most-recent transition into that
  // stage. The LATEST transition wins (HVA-141 rollback + re-advance
  // cycles).
  const execAlias = alias(users, 'exec_user');
  const breachedRows = await db
    .select({
      requestId: visitRequests.id,
      customerName: visitRequests.customerName,
      customerPhone: visitRequests.customerPhone,
      cityCaptainUserId: cities.captainUserId,
      cityName: cities.name,
      execName: execAlias.fullName,
      mostRecentEntryAt: sql<Date>`MAX(${requestStatusHistory.changedAt})`,
    })
    .from(visitRequests)
    .innerJoin(cities, eq(cities.id, visitRequests.cityId))
    .leftJoin(execAlias, eq(execAlias.id, visitRequests.assignedExecUserId))
    .innerJoin(
      requestStatusHistory,
      and(
        eq(requestStatusHistory.requestId, visitRequests.id),
        eq(requestStatusHistory.toStatusStageId, pendingStage.id),
      ),
    )
    .where(
      and(
        eq(visitRequests.statusStageId, pendingStage.id),
        isNull(visitRequests.cancelledAt),
      ),
    )
    .groupBy(
      visitRequests.id,
      visitRequests.customerName,
      visitRequests.customerPhone,
      cities.captainUserId,
      cities.name,
      execAlias.fullName,
    )
    .having(
      sql`MAX(${requestStatusHistory.changedAt}) < NOW() - (${thresholdHours} || ' hours')::INTERVAL`,
    );

  let escalated = 0;
  let skippedAlreadyEscalated = 0;

  for (const row of breachedRows) {
    // Dedup: has an `approval_escalated` audit row been written AFTER
    // the request entered PENDING_CAPTAIN_APPROVAL this time around?
    const [existing] = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.eventType, 'approval_escalated'),
          eq(auditLog.targetEntityType, 'visit_request'),
          eq(auditLog.targetEntityId, row.requestId),
          sql`${auditLog.createdAt} >= ${row.mostRecentEntryAt}`,
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(1);

    if (existing) {
      skippedAlreadyEscalated += 1;
      continue;
    }

    // Compute breach duration for the dispatch payload + audit.
    const breachedAtMs = new Date(row.mostRecentEntryAt).getTime();
    const hoursStuck = Math.floor((Date.now() - breachedAtMs) / (1000 * 60 * 60));

    await logEvent({
      eventType: 'approval_escalated',
      actorUserId: null,
      targetEntityType: 'visit_request',
      targetEntityId: row.requestId,
      beforeState: { stuckSinceIso: new Date(breachedAtMs).toISOString() },
      afterState: {
        thresholdHours,
        hoursStuck,
        customerName: row.customerName,
        cityName: row.cityName,
        cityCaptainUserId: row.cityCaptainUserId,
        execName: row.execName ?? null,
      },
    });

    try {
      await dispatchNotification('request.approval_overdue', {
        requestId: row.requestId,
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        cityName: row.cityName,
        cityCaptainUserId: row.cityCaptainUserId,
        execName: row.execName ?? 'A team member',
        hoursStuck,
        thresholdHours,
      });
    } catch (err) {
      cronLog.warn(
        {
          requestId: row.requestId,
          err: err instanceof Error ? err.message : String(err),
        },
        'escalation_dispatch_failed',
      );
    }

    escalated += 1;
  }

  cronLog.info(
    {
      thresholdHours,
      candidates: breachedRows.length,
      escalated,
      skippedAlreadyEscalated,
    },
    'escalation_run_complete',
  );

  return {
    thresholdHours,
    candidates: breachedRows.length,
    escalated,
    skippedAlreadyEscalated,
  };
}
