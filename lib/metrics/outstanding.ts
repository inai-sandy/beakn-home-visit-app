import { and, isNull, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { visitRequests } from '@/db/schema';

import { visitRequestsScopeFilter } from './scope';
import type { DateRange, MetricLoader, MetricScope } from './types';

// =============================================================================
// SSOT: outstanding
// =============================================================================
//
// outstanding = SUM across non-cancelled requests of
//   (quotation.total_order_value_paise) - (Σ inbound payments)
// when that delta is positive (≥0 floor — a "credit balance" customer
// doesn't subtract from anyone else's outstanding).
//
// Bug 7 semantics (saved memory + STATE 2026-06-03): Open Quotation +
// Outstanding both INCLUDE executed-but-unpaid orders. We therefore
// filter only on `cancelled_at IS NULL` — NOT on the status stage.
// An executed-and-paid request has outstanding = 0, so it
// automatically drops out of the sum; an executed-but-unpaid one
// stays visible.
//
// This is a SNAPSHOT metric — the `range` parameter is ignored
// (kept in the signature so the loader matches the MetricLoader
// contract and can sit in the registry next to the windowed ones).
// =============================================================================

export const loadOutstanding: MetricLoader<number> = async (
  scope: MetricScope,
  _range: DateRange,
) => {
  const scopeFilter = visitRequestsScopeFilter(scope);

  const [row] = await db
    .select({
      sum: sql<string | null>`COALESCE(SUM(
        GREATEST(
          COALESCE((
            SELECT MAX(total_order_value_paise)
            FROM quotations
            WHERE quotations.visit_request_id = ${visitRequests.id}
          ), 0)
          -
          COALESCE((
            SELECT SUM(amount_paise)
            FROM payments
            WHERE payments.visit_request_id = ${visitRequests.id}
              AND payments.direction = 'inbound'
              AND payments.voided_at IS NULL
          ), 0),
          0
        )
      )::text, '0')`,
    })
    .from(visitRequests)
    .where(and(isNull(visitRequests.cancelledAt), scopeFilter));

  return Number(row?.sum ?? '0');
};
