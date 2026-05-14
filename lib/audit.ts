// =============================================================================
// Audit trail service — spec §14, HVA-18
// =============================================================================
//
// `logEvent(...)` writes a row into the `audit_log` table. Whether a given
// event type is actually persisted is driven by the `audit_enabled_events`
// config key (see lib/config-schema.ts) — admins toggle inclusion per type
// via the Settings Hub.
//
// HARD RULE (spec §3.2): re-assignment events are logged unconditionally,
// even if the admin disables 'reassignment' in `audit_enabled_events`. The
// system-internal record of who reassigned which request to whom must
// survive admin toggling. Enforced via `SYSTEM_ALWAYS_AUDITED` below.
//
// Failure mode: audit writes NEVER throw to the caller. If the DB write
// fails (connection refused, schema mismatch, …) the error is logged via
// the application logger (pino) and the function returns. Audit telemetry
// must never break the action being audited.
// =============================================================================

import { desc } from 'drizzle-orm';

import { db } from '@/db/client';
import { auditLog, userRoleEnum } from '@/db/schema';

import { getConfig } from './config';
import { log } from './logger';

const auditLogger = log.child({ component: 'audit' });

type UserRole = (typeof userRoleEnum.enumValues)[number];

export interface LogEventInput {
  /** Snake_case identifier matching the audit_enabled_events allow-list. */
  eventType: string;
  /** UUID of the acting user, or null for system events (cron, seed, etc.). */
  actorUserId?: string | null;
  /** Snapshot of the actor's role at event time — survives later role changes / user deletion. */
  actorRole?: UserRole | null;
  /** Logical entity kind: 'visit_request', 'lead', 'config_key', 'task', 'system', etc. */
  targetEntityType: string;
  /** UUID of the target entity, or a text key (e.g. config key name). Null for create-of-new events. */
  targetEntityId?: string | null;
  /** State BEFORE the change (for diff-ability). Null on create. */
  beforeState?: Record<string, unknown> | null;
  /** State AFTER the change. Null on delete. */
  afterState?: Record<string, unknown> | null;
  /** Optional free-text reason (e.g. cancellation explanation). */
  reason?: string | null;
  /** IPv4 or IPv6 string, or null when no request context is available. */
  ipAddress?: string | null;
  /** Raw User-Agent header, or null when no request context is available. */
  userAgent?: string | null;
}

/**
 * Event types that are ALWAYS persisted to audit_log, regardless of the
 * admin-controlled audit_enabled_events allow-list. Driven by hard rules
 * in the spec — adding to this set is a policy decision, not configuration.
 */
const SYSTEM_ALWAYS_AUDITED: ReadonlySet<string> = new Set([
  'reassignment',
]);

/**
 * Record an audit event. Returns silently on any failure — see file header
 * for the "audit never breaks the caller" contract.
 */
export async function logEvent(input: LogEventInput): Promise<void> {
  try {
    if (!(await shouldLog(input.eventType))) {
      return;
    }

    await db.insert(auditLog).values({
      eventType: input.eventType,
      actorUserId: input.actorUserId ?? null,
      actorRole: input.actorRole ?? null,
      targetEntityType: input.targetEntityType,
      targetEntityId: input.targetEntityId ?? null,
      beforeState: input.beforeState ?? null,
      afterState: input.afterState ?? null,
      reason: input.reason ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });
  } catch (err) {
    auditLogger.error(
      {
        eventType: input.eventType,
        targetEntityType: input.targetEntityType,
        targetEntityId: input.targetEntityId ?? null,
        err: err instanceof Error ? err : String(err),
      },
      'logEvent_failed',
    );
  }
}

/**
 * Inclusion decision:
 * - System-always-audited event types: ALWAYS true (spec §3.2).
 * - All other event types: true iff `audit_enabled_events` config contains them.
 * - If reading the config itself fails (DB degraded, etc.): default to true.
 *   Over-logging beats silently dropping the audit trail.
 */
async function shouldLog(eventType: string): Promise<boolean> {
  if (SYSTEM_ALWAYS_AUDITED.has(eventType)) return true;
  try {
    const enabled = (await getConfig('audit_enabled_events')) as string[];
    return enabled.includes(eventType);
  } catch (err) {
    auditLogger.error(
      {
        eventType,
        err: err instanceof Error ? err : String(err),
        fallback: 'log',
      },
      'shouldLog_config_read_failed',
    );
    return true;
  }
}

/**
 * Read the most recent N audit rows, newest first. Used by /dev/audit-health
 * and admin UI later. Doesn't filter or paginate; that's the caller's job.
 */
export async function recentAuditEvents(limit = 20) {
  return db
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}
