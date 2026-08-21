// =============================================================================
// HVA-346: a timestamp selected through raw `sql` is a STRING, not a Date
// =============================================================================
//
// Drizzle maps a declared timestamp COLUMN to a JS `Date`. A value produced by
// a raw `sql` fragment — an aggregate, a scalar subquery — gets no such
// treatment: the postgres driver hands it back as the string it read off the
// wire, and `sql<Date>` is a type ASSERTION, not a conversion. It tells the
// compiler a lie and the compiler believes it.
//
// That lie cost a production outage. `lib/admin/dashboard-queries.ts` selected
// the aging-approval timestamp through a subquery, typed it `sql<Date>`, and
// sorted the alert feed with `b.at.getTime() - a.at.getTime()`. On
// 2026-08-21 the admin dashboard began throwing
// `TypeError: a.at.getTime is not a function` for every super_admin, and
// because login redirects there, it read to Sandeep as "I cannot log in".
//
// It had been latent for two months. `Array.prototype.sort` does not call its
// comparator on a single-element array, so the crash needed a SECOND alert to
// appear before it could fire — which is the nastiest property of this bug
// class: the type is wrong from the first line, and nothing tells you until
// the data arranges itself just so.
//
// The rule: raw timestamp selections are typed `sql<string>`, which is the
// truth, and run through `rawTimestampToDate` at the point of use. Typing them
// honestly is the load-bearing half — it makes `tsc` fail at every consumer,
// so the next one has to make a decision instead of inheriting a lie.
// =============================================================================

/**
 * Coerce a raw-SQL timestamp into a `Date`.
 *
 * Accepts a `Date` too, so a call site is safe whether its value came from a
 * mapped column or a raw fragment — the distinction is exactly the one that
 * is easy to get wrong, and a helper that only worked for one of them would
 * just move the trap.
 *
 * Throws on an unparseable value rather than returning an Invalid Date.
 * An Invalid Date propagates silently — `getTime()` yields NaN, sorts become
 * meaningless, and `formatDistanceToNow` renders "Invalid Date" to a user.
 * A timestamp that came back unreadable is a real fault and should say so
 * where it happened.
 */
export function rawTimestampToDate(value: Date | string | number): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError('rawTimestampToDate received an Invalid Date');
    }
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(
      `rawTimestampToDate could not parse ${JSON.stringify(value)}`,
    );
  }
  return parsed;
}

/**
 * The nullable variant, for a scalar subquery or aggregate that can return
 * NULL — `MAX()` over no rows, or a LEFT JOIN that found nothing.
 */
export function rawTimestampToDateOrNull(
  value: Date | string | number | null | undefined,
): Date | null {
  if (value === null || value === undefined) return null;
  return rawTimestampToDate(value);
}
