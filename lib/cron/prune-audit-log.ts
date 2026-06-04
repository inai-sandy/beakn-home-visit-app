import { sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { auditLog } from '@/db/schema';
import { logEvent } from '@/lib/audit';
import { getConfig } from '@/lib/config';
import { log } from '@/lib/logger';

// =============================================================================
// HVA-224: prune-audit-log cron
// =============================================================================
//
// Deletes audit_log rows older than the admin-configured
// `audit_log_retention_months`. Runs daily at 02:30 IST. Retention = 0
// disables pruning — rows kept forever.
//
// Writes a single `audit_log_pruned` row with the count + cutoff at end
// so the policy itself stays traceable.
// =============================================================================

const cronLog = log.child({ component: 'cron.prune-audit-log' });

export interface PruneResult {
  retentionMonths: number;
  cutoffIso: string;
  deletedCount: number;
}

export async function pruneAuditLog(): Promise<PruneResult> {
  const retentionMonths = await getConfig('audit_log_retention_months');
  if (retentionMonths <= 0) {
    cronLog.info({ retentionMonths }, 'prune_disabled');
    return {
      retentionMonths,
      cutoffIso: '',
      deletedCount: 0,
    };
  }

  // Compute cutoff in JS so the audit log row's `before_state` carries
  // an explicit ISO string. The DELETE still uses a SQL interval to
  // honor the database's clock.
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - retentionMonths);

  const result = await db.execute(
    sql`DELETE FROM ${auditLog} WHERE ${auditLog.createdAt} < NOW() - (${retentionMonths} || ' months')::INTERVAL`,
  );

  // postgres-js DELETE returns { count } in result; defensive cast.
  const deletedCount = Number(
    (result as unknown as { count?: number }).count ??
      (result as unknown as { rowCount?: number }).rowCount ??
      0,
  );

  await logEvent({
    eventType: 'audit_log_pruned',
    actorUserId: null,
    targetEntityType: 'system',
    targetEntityId: null,
    beforeState: { cutoffIso: cutoff.toISOString() },
    afterState: { retentionMonths, deletedCount },
  });

  cronLog.info(
    { retentionMonths, cutoffIso: cutoff.toISOString(), deletedCount },
    'prune_complete',
  );

  return {
    retentionMonths,
    cutoffIso: cutoff.toISOString(),
    deletedCount,
  };
}
