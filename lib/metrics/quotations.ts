import { and, eq, gte, lte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { quotations, visitRequests } from '@/db/schema';

import { visitRequestsScopeFilter } from './scope';
import type { DateRange, MetricLoader, MetricScope } from './types';

// =============================================================================
// SSOT: quotations_count, quotations_value
// =============================================================================
//
// `quotations_*` = quotations whose `submitted_at` falls in the window.
// Quotations are 1:1 with visit_request via UNIQUE FK, so no DISTINCT
// dance is needed; one quotation = one row.
//
// submitted_at is timestamptz → IST timezone wrap on the date cast so
// the window respects IST midnight, not UTC.
//
// Scope filter is the visit-request scope: a quotation is attributed
// to the request's currently-assigned exec / captain / city.
// =============================================================================

export const loadQuotationsCount: MetricLoader<number> = async (
  scope: MetricScope,
  range: DateRange,
) => {
  const scopeFilter = visitRequestsScopeFilter(scope);

  const [row] = await db
    .select({ cnt: sql<number>`COUNT(*)::int` })
    .from(quotations)
    .innerJoin(visitRequests, eq(visitRequests.id, quotations.visitRequestId))
    .where(
      and(
        gte(
          sql`(${quotations.submittedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          range.fromDate,
        ),
        lte(
          sql`(${quotations.submittedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          range.toDate,
        ),
        // HVA-281: only CartPlus quotations are real; manual rows are targets.
        eq(quotations.source, 'portal'),
        scopeFilter,
      ),
    );

  return row?.cnt ?? 0;
};

export const loadQuotationsValue: MetricLoader<number> = async (
  scope: MetricScope,
  range: DateRange,
) => {
  const scopeFilter = visitRequestsScopeFilter(scope);

  const [row] = await db
    .select({
      sum: sql<string | null>`COALESCE(SUM(${quotations.totalOrderValuePaise})::text, '0')`,
    })
    .from(quotations)
    .innerJoin(visitRequests, eq(visitRequests.id, quotations.visitRequestId))
    .where(
      and(
        gte(
          sql`(${quotations.submittedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          range.fromDate,
        ),
        lte(
          sql`(${quotations.submittedAt} AT TIME ZONE 'Asia/Kolkata')::date`,
          range.toDate,
        ),
        // HVA-281: only CartPlus quotations are real; manual rows are targets.
        eq(quotations.source, 'portal'),
        scopeFilter,
      ),
    );

  return Number(row?.sum ?? '0');
};
