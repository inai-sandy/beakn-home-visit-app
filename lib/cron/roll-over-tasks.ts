import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { auditLog, tasks } from '@/db/schema';
import { getConfig } from '@/lib/config';
import { log } from '@/lib/logger';
import { getIstDateString } from '@/lib/today/time';

// =============================================================================
// HVA-169: pending-task roll-over (21:31 IST daily)
// =============================================================================
//
// Tasks created on a previous IST day and never closed out (status='pending')
// get `rolled_over_at` stamped. `task_date` stays put — preserving the audit
// trail of which day's plan the task originated on. The exec dashboard then
// renders these in the Pending accordion with a "Rolled over from <date>"
// pill so the exec can still resolve them.
//
// Captain red-flag (see lib/captain/dashboard-queries.ts.loadTeamExecStatuses)
// raises when any task has `rolled_over_at < NOW() - INTERVAL '3 days'`.
//
// Caller contract:
//   - GET /api/cron/roll-over-tasks (cron-fired) with a Bearer CRON_SECRET.
//   - Returns { rolledOver, auditWritten } so the cron line in host crontab
//     can log success/skip counts.
//
// Audit emission: ONE multi-row INSERT covering every rolled-over task. The
// per-row eventType is gated by config.audit_enabled_events; if the gate is
// off we skip the audit insert entirely. actor_user_id = null (system).
// =============================================================================

export interface RollOverResult {
  /** Number of tasks whose rolled_over_at was newly stamped this run. */
  rolledOver: number;
  /** Number of audit_log rows inserted. Equals `rolledOver` when the audit
   *  gate is on, else 0. */
  auditWritten: number;
}

export async function rollOverPendingTasks(now: Date = new Date()): Promise<RollOverResult> {
  const todayIst = getIstDateString(now);

  // Single UPDATE … RETURNING. Postgres locks rows naturally so a second
  // concurrent run (re-invoked cron, manual probe) cannot double-stamp:
  // the second statement's WHERE clause sees `rolled_over_at IS NOT NULL`
  // already populated and matches zero rows.
  const rolled = await db
    .update(tasks)
    .set({ rolledOverAt: now })
    .where(
      and(
        eq(tasks.status, 'pending'),
        // task_date is a DATE column; compare against IST today string cast.
        sql`${tasks.taskDate} < ${todayIst}::date`,
        isNull(tasks.rolledOverAt),
      ),
    )
    .returning({ id: tasks.id, taskDate: tasks.taskDate });

  if (rolled.length === 0) {
    return { rolledOver: 0, auditWritten: 0 };
  }

  // Audit gate — same logic as lib/audit.ts.shouldLog but inlined so we can
  // batch into one insert rather than 250 sequential round-trips. If reading
  // the config row fails, default to writing (over-log beats silently
  // dropping the audit trail — same fallback as lib/audit.ts).
  let auditEnabled = true;
  try {
    const enabled = (await getConfig('audit_enabled_events')) as string[];
    auditEnabled = enabled.includes('task_rolled_over');
  } catch (err) {
    log.error(
      { component: 'cron.roll-over-tasks', err: err instanceof Error ? err : String(err) },
      'audit_gate_read_failed',
    );
  }

  let auditWritten = 0;
  if (auditEnabled) {
    try {
      await db.insert(auditLog).values(
        rolled.map((r) => ({
          eventType: 'task_rolled_over',
          actorUserId: null,
          actorRole: null,
          targetEntityType: 'task',
          targetEntityId: r.id,
          beforeState: null,
          afterState: {
            rolledOverAt: now.toISOString(),
            originalTaskDate: r.taskDate,
          },
          reason: null,
          ipAddress: null,
          userAgent: null,
        })),
      );
      auditWritten = rolled.length;
    } catch (err) {
      // Audit failures NEVER break the cron — same contract as logEvent().
      log.error(
        {
          component: 'cron.roll-over-tasks',
          count: rolled.length,
          err: err instanceof Error ? err : String(err),
        },
        'audit_insert_failed',
      );
    }
  }

  log.info(
    {
      component: 'cron.roll-over-tasks',
      rolledOver: rolled.length,
      auditWritten,
      istDate: todayIst,
    },
    'roll_over_complete',
  );

  return { rolledOver: rolled.length, auditWritten };
}
