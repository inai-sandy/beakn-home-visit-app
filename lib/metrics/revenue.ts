import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { payments, visitRequests } from '@/db/schema';

import { visitRequestsScopeFilter } from './scope';
import type { DateRange, MetricLoader, MetricScope } from './types';

// =============================================================================
// SSOT: revenue (net cash collected)
// =============================================================================
//
// `revenue` = SUM(inbound) − SUM(outbound) over payments in the window.
// Both directions are filtered by `voided_at IS NULL` (voids exclude
// the payment entirely, regardless of direction) and by `payment_date`
// between the range bounds.
//
// Sandeep 2026-06-03: previously this counted only inbound payments,
// so a request with a ₹5,000 inbound + ₹10,000 refund on the same day
// showed +₹5,000 revenue even though the customer's money has fully
// left the till. Refunds reduce realised revenue; this loader now
// reflects net cash.
//
// payment_date is a plain `date` column (no IST wrap needed). Scope
// is anchored on visit_requests.assigned_exec_user_id (saved memory
// `attribution-vs-action-taker` — credit follows the deal owner, not
// the user who recorded the payment / refund).
// =============================================================================

export const loadRevenue: MetricLoader<number> = async (
  scope: MetricScope,
  range: DateRange,
) => {
  const scopeFilter = visitRequestsScopeFilter(scope);

  const [row] = await db
    .select({
      sum: sql<string | null>`COALESCE(SUM(
        CASE WHEN ${payments.direction} = 'inbound'  THEN  ${payments.amountPaise}
             WHEN ${payments.direction} = 'outbound' THEN -${payments.amountPaise}
             ELSE 0 END
      )::text, '0')`,
    })
    .from(payments)
    .innerJoin(visitRequests, eq(visitRequests.id, payments.visitRequestId))
    .where(
      and(
        isNull(payments.voidedAt),
        gte(payments.paymentDate, range.fromDate),
        lte(payments.paymentDate, range.toDate),
        scopeFilter,
      ),
    );

  return Number(row?.sum ?? '0');
};
