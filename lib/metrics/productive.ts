import { and, eq, gte, lte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { tasks } from '@/db/schema';

import { tasksScopeFilter } from './scope';
import type { DateRange, MetricLoader, MetricScope } from './types';

// =============================================================================
// SSOT: productive_minutes
// =============================================================================
//
// productive_minutes = SUM of estimated minutes across completed tasks
// in the window. Uses `actual_time` when present (a self-reported
// override during Mark as Done), otherwise falls back to
// `estimated_time`.
//
// estimated_time / actual_time are varchar buckets — '15min', '30min',
// '1hr', '2hr', '3hr+' — converted to integer minutes in SQL via the
// same mapping as `lib/today/time.ts:parseEstimatedMinutes`. Keeping
// the conversion in SQL means a 5,000-task captain bucket adds up in
// one round-trip instead of streaming rows to Node.
//
// Scope is anchored on tasks.exec_user_id (same as the visits loader).
// =============================================================================

export const loadProductiveMinutes: MetricLoader<number> = async (
  scope: MetricScope,
  range: DateRange,
) => {
  const scopeFilter = tasksScopeFilter(scope);

  const [row] = await db
    .select({
      sum: sql<number>`COALESCE(SUM(
        CASE COALESCE(${tasks.actualTime}, ${tasks.estimatedTime})
          WHEN '15min' THEN 15
          WHEN '30min' THEN 30
          WHEN '1hr'   THEN 60
          WHEN '2hr'   THEN 120
          WHEN '3hr+'  THEN 180
          ELSE 0
        END
      ), 0)::int`,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.status, 'completed'),
        gte(tasks.taskDate, range.fromDate),
        lte(tasks.taskDate, range.toDate),
        scopeFilter,
      ),
    );

  return row?.sum ?? 0;
};
