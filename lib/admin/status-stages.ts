import { asc, eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { statusStages, visitRequests } from '@/db/schema';

// =============================================================================
// HVA-222: data layer for /admin/settings/workflow/status-stages
// =============================================================================
//
// Loads every status stage with the count of visit_requests pointing at
// it. The count is rendered on the admin page so admins know how many
// rows would break if they tried to delete the stage.
// =============================================================================

export interface StatusStageRow {
  id: string;
  code: string;
  name: string;
  sequenceNumber: number;
  isActive: boolean;
  isTerminal: boolean;
  description: string | null;
  requestCount: number;
}

export async function loadStatusStagesWithCounts(): Promise<StatusStageRow[]> {
  // Two-trip approach — one row per stage, plus a per-stage count from
  // a separate GROUP BY. Cheaper to reason about than a correlated
  // subquery with Drizzle's table-tag interpolation (which fights with
  // self-join aliasing inside ${visitRequests} when the outer query
  // already references status_stages).
  const [stageRows, countRows] = await Promise.all([
    db
      .select({
        id: statusStages.id,
        code: statusStages.code,
        name: statusStages.name,
        sequenceNumber: statusStages.sequenceNumber,
        isActive: statusStages.isActive,
        isTerminal: statusStages.isTerminal,
        description: statusStages.description,
      })
      .from(statusStages)
      .orderBy(asc(statusStages.sequenceNumber)),
    db
      .select({
        stageId: visitRequests.statusStageId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(visitRequests)
      .groupBy(visitRequests.statusStageId),
  ]);

  const countByStage = new Map<string, number>();
  for (const row of countRows) {
    countByStage.set(row.stageId, Number(row.count));
  }

  return stageRows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    sequenceNumber: r.sequenceNumber,
    isActive: r.isActive,
    isTerminal: r.isTerminal,
    description: r.description,
    requestCount: countByStage.get(r.id) ?? 0,
  }));
}

/** Standalone count helper — used by the delete action's confirm dialog. */
export async function countRequestsOnStage(stageId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(visitRequests)
    .where(eq(visitRequests.statusStageId, stageId));
  return Number(count ?? 0);
}
