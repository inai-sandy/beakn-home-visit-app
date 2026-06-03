import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { payments, visitRequests } from '@/db/schema';

import { visitRequestsScopeFilter } from './scope';
import type { DateRange, MetricLoader, MetricScope } from './types';

// =============================================================================
// SSOT: revenue
// =============================================================================
//
// `revenue` = SUM(payments.amount_paise) WHERE
//   direction = 'inbound' AND voided_at IS NULL AND
//   payment_date BETWEEN fromDate AND toDate AND
//   <scope filter on the parent visit_request>
//
// payment_date is a plain `date` column (no IST wrap needed). Direction
// 'inbound' excludes refunds; voided_at IS NULL excludes payments
// reversed after the fact.
//
// Attribution semantics: we filter on the visit_request's
// assigned_exec_user_id (not the user who recorded the payment) — this
// matches the saved memory rule attribution-vs-action-taker. Captains
// or admins recording payments on behalf of execs still credit the
// exec.
// =============================================================================

export const loadRevenue: MetricLoader<number> = async (
  scope: MetricScope,
  range: DateRange,
) => {
  const scopeFilter = visitRequestsScopeFilter(scope);

  const [row] = await db
    .select({
      sum: sql<string | null>`COALESCE(SUM(${payments.amountPaise})::text, '0')`,
    })
    .from(payments)
    .innerJoin(visitRequests, eq(visitRequests.id, payments.visitRequestId))
    .where(
      and(
        eq(payments.direction, 'inbound'),
        isNull(payments.voidedAt),
        gte(payments.paymentDate, range.fromDate),
        lte(payments.paymentDate, range.toDate),
        scopeFilter,
      ),
    );

  return Number(row?.sum ?? '0');
};
