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
//   max(quotation_total - net_paid, 0)
// where net_paid = SUM(inbound) − SUM(outbound) on non-voided payments.
//
// Sandeep 2026-06-03: previously the inner "paid" subquery only summed
// inbound payments. For the Singham request — ₹10,000 inbound +
// ₹10,000 outbound refund — that reported ₹65,000 outstanding on a
// ₹75,000 quotation (because it subtracted ₹10,000 inbound but
// ignored the matching outbound refund). Net paid is now correctly 0
// for that case, so outstanding shows the full ₹75,000 owed.
//
// Bug 7 semantics: Open Quotation + Outstanding both include
// executed-but-unpaid orders. We filter only on `cancelled_at IS NULL`
// — NOT on the status stage. Fully-paid executed requests have
// outstanding = 0 (the `GREATEST(..., 0)` floor) so they self-drop
// from the sum.
//
// This is a SNAPSHOT metric — the `range` parameter is ignored
// (kept in the signature so the loader matches the MetricLoader
// contract and can sit in the registry next to windowed ones).
// =============================================================================

export const loadOutstanding: MetricLoader<number> = async (
  scope: MetricScope,
  _range: DateRange,
) => {
  const scopeFilter = visitRequestsScopeFilter(scope);

  // HVA-277 bug fix: the correlation MUST be table-qualified by hand.
  // `${visitRequests.id}` renders as bare `"id"` inside this raw
  // template, and SQL name scoping resolves a bare `id` inside the
  // subqueries to the INNER table's own id (quotations.id /
  // payments.id) — the correlation never matched and Outstanding
  // returned 0 for every scope on every portal. `${visitRequests}.id`
  // renders the qualified `"visit_requests".id`.
  const [row] = await db
    .select({
      sum: sql<string | null>`COALESCE(SUM(
        GREATEST(
          COALESCE((
            SELECT MAX(total_order_value_paise)
            FROM quotations
            WHERE quotations.visit_request_id = ${visitRequests}.id
              AND quotations.source = 'portal'
          ), 0)
          -
          COALESCE((
            SELECT SUM(
              CASE WHEN payments.direction = 'inbound'  THEN  payments.amount_paise
                   WHEN payments.direction = 'outbound' THEN -payments.amount_paise
                   ELSE 0 END
            )
            FROM payments
            WHERE payments.visit_request_id = ${visitRequests}.id
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
