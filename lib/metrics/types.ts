// =============================================================================
// Metric SSOT — shared types
// =============================================================================
//
// Sandeep 2026-06-03: every metric tile across exec / captain / admin
// portals must show the SAME number computed the SAME way. The only
// thing that varies between portals is SCOPE — which subset of execs /
// cities / requests the tile is rolled up over.
//
// `MetricScope` is the single argument that captures this. Each loader
// in lib/metrics/* accepts a scope + a date range and returns a single
// number (or null for percent-with-no-denominator metrics). The same
// loader runs unchanged across every portal — different scope → different
// number, but the same formula always.
//
// SCOPE SHAPES (mutually exclusive — set exactly one):
//
//   • { execUserId }    — exec-scoped: all requests/payments/tasks
//                         attributed to this exec.
//   • { captainUserId } — captain-scoped: every exec under this captain
//                         (via sales_executives.captain_user_id).
//   • { cityId }        — city-scoped: every request whose
//                         visit_requests.city_id matches (per Sandeep's
//                         2026-06-03 confirmation — request location
//                         drives the city scope, not exec location).
//   • {} (no field set) — global / all rows. Used by the admin Hero +
//                         KPI strip when showing company-wide totals.
//
// PASS THROUGH MULTIPLE: callers may NOT combine fields. The TS shape
// allows it but `applyScope` (lib/metrics/scope.ts) treats only the
// "most specific" one. To avoid ambiguity at the call site every page
// should pass exactly one — or none for the global case.
//
// ATTRIBUTION (per saved memory attribution-vs-action-taker):
//   • Orders / Revenue / Conversion → request's currently-assigned exec
//     at query time (visit_requests.assigned_exec_user_id), NOT the
//     user who fired the transition or recorded the payment.
//   • This is the "deal-owner of record" semantic that admin / captain
//     / leaderboard / target-progress all already use.
// =============================================================================

export interface MetricScope {
  /** Filter to a single exec's data. */
  execUserId?: string;
  /** Filter to all execs under a captain. */
  captainUserId?: string;
  /** Filter to all requests whose city_id matches (per Sandeep 2026-06-03). */
  cityId?: string;
}

/** Inclusive IST date range. Both ends are `YYYY-MM-DD` strings. For a
 *  single-day metric, pass `{ fromDate: X, toDate: X }`. */
export interface DateRange {
  fromDate: string;
  toDate: string;
}

/** Convenience — single-day window for "today". */
export function singleDayRange(istDate: string): DateRange {
  return { fromDate: istDate, toDate: istDate };
}

/** Convenience — last N days ending today, inclusive. */
export function lastNDaysRange(istToday: string, n: number): DateRange {
  if (n < 1) return singleDayRange(istToday);
  const [y, m, d] = istToday.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  start.setUTCDate(start.getUTCDate() - (n - 1));
  const fromDate = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-${String(start.getUTCDate()).padStart(2, '0')}`;
  return { fromDate, toDate: istToday };
}

/** Every metric key recognised by the registry. Keep this enum in sync
 *  with the keys exported from `lib/metrics/registry.ts`. */
export type MetricKey =
  | 'revenue'              // inbound payments collected (paise)
  | 'orders_count'         // distinct requests that confirmed in range
  | 'orders_value'         // sum of confirmed orders' quotation value (paise)
  | 'visits'               // completed visit-type tasks in range
  | 'quotations_count'     // quotations submitted in range
  | 'quotations_value'     // sum of submitted quotations' value (paise)
  | 'conversion_pct'       // orders_count / visits as %; null when visits=0
  | 'outstanding'          // open balance owed across non-cancelled requests (paise)
  | 'new_requests'         // visit_requests.created_at in range
  | 'cancelled_requests'   // visit_requests.cancelled_at in range
  | 'productive_minutes'   // sum of estimated minutes on completed tasks
  | 'pending_approvals';   // snapshot count, range ignored

/** Loader contract. Range may be ignored by snapshot metrics
 *  (pending_approvals, outstanding) — they always return "as of now". */
export type MetricLoader<T = number | null> = (
  scope: MetricScope,
  range: DateRange,
) => Promise<T>;
