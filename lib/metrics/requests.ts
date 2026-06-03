import { and, gte, isNotNull, lte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { visitRequests } from '@/db/schema';

import { visitRequestsScopeFilter } from './scope';
import type { DateRange, MetricLoader, MetricScope } from './types';

// =============================================================================
// SSOT: new_requests, cancelled_requests
// =============================================================================
//
// new_requests = COUNT(*) of visit_requests whose created_at IST-date
// is within the window. Counts every request — cancelled or not —
// because intake volume is the input metric, not net pipeline.
//
// cancelled_requests = COUNT(*) of visit_requests whose cancelled_at
// IST-date is within the window. Captures the cancel event itself, not
// the original creation date.
//
// Both fields are timestamptz → IST wrap on the date cast.
// =============================================================================

export const loadNewRequests: MetricLoader<number> = async (
  scope: MetricScope,
  range: DateRange,
) => {
  const scopeFilter = visitRequestsScopeFilter(scope);

  const [row] = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(visitRequests)
    .where(
      and(
        gte(
          sql`(${visitRequests.createdAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          range.fromDate,
        ),
        lte(
          sql`(${visitRequests.createdAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          range.toDate,
        ),
        scopeFilter,
      ),
    );

  return row?.cnt ?? 0;
};

export const loadCancelledRequests: MetricLoader<number> = async (
  scope: MetricScope,
  range: DateRange,
) => {
  const scopeFilter = visitRequestsScopeFilter(scope);

  const [row] = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(visitRequests)
    .where(
      and(
        isNotNull(visitRequests.cancelledAt),
        gte(
          sql`(${visitRequests.cancelledAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          range.fromDate,
        ),
        lte(
          sql`(${visitRequests.cancelledAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          range.toDate,
        ),
        scopeFilter,
      ),
    );

  return row?.cnt ?? 0;
};
