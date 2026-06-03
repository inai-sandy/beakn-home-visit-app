import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { tasks } from '@/db/schema';

import { VISIT_TASK_TYPES } from './constants';
import { tasksScopeFilter } from './scope';
import type { DateRange, MetricLoader, MetricScope } from './types';

// =============================================================================
// SSOT: visits
// =============================================================================
//
// `visits` = COUNT(*) of completed tasks whose task_type ∈ VISIT_TASK_TYPES
// and task_date is within [fromDate, toDate].
//
// task_date is a plain `date` column → no IST wrap needed.
// status = 'completed' to exclude pending/postponed/cancelled tasks.
//
// Scope is anchored on tasks.exec_user_id via `tasksScopeFilter`. For
// exec scope this is the exec themselves; for captain/city scope it
// resolves to the exec set under that captain/city (post-Bug 8 schema
// — sales_executives.city_id is the source of truth).
// =============================================================================

export const loadVisits: MetricLoader<number> = async (
  scope: MetricScope,
  range: DateRange,
) => {
  const scopeFilter = tasksScopeFilter(scope);

  const [row] = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(tasks)
    .where(
      and(
        inArray(
          tasks.taskType,
          VISIT_TASK_TYPES as unknown as readonly (typeof VISIT_TASK_TYPES)[number][],
        ),
        eq(tasks.status, 'completed'),
        gte(tasks.taskDate, range.fromDate),
        lte(tasks.taskDate, range.toDate),
        scopeFilter,
      ),
    );

  return row?.cnt ?? 0;
};
