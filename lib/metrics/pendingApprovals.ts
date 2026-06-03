import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { statusStages, visitRequests } from '@/db/schema';

import { STATUS_CODES } from './constants';
import { visitRequestsScopeFilter } from './scope';
import type { DateRange, MetricLoader, MetricScope } from './types';

// =============================================================================
// SSOT: pending_approvals
// =============================================================================
//
// pending_approvals = COUNT(*) of non-cancelled visit_requests currently
// sitting at the PENDING_CAPTAIN_APPROVAL stage.
//
// This is a SNAPSHOT metric — the `range` parameter is ignored. The
// captain dashboard sometimes filters approvals "received in window";
// the SSOT loader instead exposes the in-tray queue depth so the same
// number appears on every portal. Window-filtered variants belong in
// the operations queues / list pages, not the dashboard tile.
// =============================================================================

export const loadPendingApprovals: MetricLoader<number> = async (
  scope: MetricScope,
  _range: DateRange,
) => {
  const scopeFilter = visitRequestsScopeFilter(scope);

  const [stage] = await db
    .select({ id: statusStages.id })
    .from(statusStages)
    .where(eq(statusStages.code, STATUS_CODES.PENDING_CAPTAIN_APPROVAL))
    .limit(1);
  if (!stage) return 0;

  const [row] = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(visitRequests)
    .where(
      and(
        eq(visitRequests.statusStageId, stage.id),
        isNull(visitRequests.cancelledAt),
        scopeFilter,
      ),
    );

  return row?.cnt ?? 0;
};
