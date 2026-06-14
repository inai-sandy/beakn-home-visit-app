// =============================================================================
// Date / time helpers — Asia/Kolkata (IST) is the application's display zone
// =============================================================================
//
// CONVENTION: all dates in this codebase are stored as UTC in Postgres
// (`timestamp with time zone`, per HVA-14 schema convention). When showing
// them to users, parsing user input, or doing calendar-day arithmetic
// (week/month/day boundaries), ALWAYS go through this module. Direct calls
// like `new Date().toISOString()` for user-facing display are forbidden by
// docs/decisions.md — they will produce wrong-day rendering for anyone west
// of Kolkata between 00:00 and 05:30 IST.
//
// What lives here:
//   - TIMEZONE constant — pinned to 'Asia/Kolkata'.
//   - toIst(date)        — format a UTC Date as a human-readable IST string.
//   - fromIstInput(s)    — parse a "wall clock" IST string back to a UTC Date
//                          (suitable for DB writes).
//   - formatIso(date)    — UTC ISO 8601 string (for logs, audit_log, opaque IDs).
//   - isWeekStart(d, wk) — true iff `d` falls on the configured week start
//                          (defaults to Tuesday per spec §11 + HVA-17 config).
//   - addDaysIst(d, n)   — calendar-day addition respecting IST boundaries.
//   - parseDate(s)       — forgiving parser for common formats, returns UTC Date.
//
// What DOESN'T live here:
//   - Formatting for the audit_log timestamp column — use formatIso for that;
//     audit rows are server-emitted and consumed by other servers/scripts,
//     they should stay UTC.
//   - Day-plan cron times (`day_plan_cutoff_time` config key, default '09:30')
//     — those are stored as "HH:MM" strings; comparing them to "now" needs
//     `formatInTimeZone(now, TIMEZONE, 'HH:mm')` then string compare.
//
// =============================================================================

import { addDays as addDaysUtc, getDay, parseISO } from 'date-fns';
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz';

/** Pinned IANA zone for all user-facing date rendering and IST input parsing. */
export const TIMEZONE = 'Asia/Kolkata' as const;

/** date-fns weekday number for the spec default week start (Tuesday = 2). */
const TUESDAY = 2;

/** Map a config 'week_start_day' string to the date-fns weekday number. */
const WEEKDAY_LOOKUP: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

/**
 * Format a UTC Date as a human-readable IST string.
 * Example: `toIst(new Date('2026-05-15T00:00:00Z'))` → `"15 May 2026, 5:30 AM"`.
 */
export function toIst(date: Date): string {
  return formatInTimeZone(date, TIMEZONE, "d MMM yyyy, h:mm a");
}

/**
 * Parse an IST "wall clock" string into a UTC Date suitable for DB writes.
 * Accepts ISO-like strings: `"2026-05-15T14:30"`, `"2026-05-15 14:30:00"`,
 * `"2026-05-15"` (interpreted as midnight IST), etc.
 *
 * Throws on input the parser can't make sense of — callers should validate
 * with Zod first (see lib/validators).
 */
export function fromIstInput(istString: string): Date {
  // parseISO handles both T-separated and space-separated forms; if the
  // string lacks a time it defaults to midnight. The result is a "naïve"
  // Date object — fromZonedTime then interprets it as IST wall clock.
  const naive = parseISO(istString.replace(' ', 'T'));
  if (Number.isNaN(naive.getTime())) {
    throw new Error(`fromIstInput: cannot parse "${istString}"`);
  }
  return fromZonedTime(naive, TIMEZONE);
}

/**
 * UTC ISO 8601 string. Use for logs, audit rows, opaque external identifiers
 * — anywhere a server consumes the value rather than a user reading it.
 */
export function formatIso(date: Date): string {
  return date.toISOString();
}

/**
 * True iff `date` falls on the configured week start in IST.
 *
 * `weekStartDay` should come from the `week_start_day` config key
 * (default 'tuesday'). Caller is responsible for the lookup; we don't
 * touch `getConfig` here to keep this module pure + sync.
 */
export function isWeekStart(date: Date, weekStartDay = 'tuesday'): boolean {
  const target = WEEKDAY_LOOKUP[weekStartDay.toLowerCase()] ?? TUESDAY;
  const zonedDate = toZonedTime(date, TIMEZONE);
  return getDay(zonedDate) === target;
}

/**
 * Calendar-day addition respecting IST boundaries. Adding 1 day to "today
 * at 23:00 IST" returns "tomorrow at 23:00 IST" (NOT "today + 24h UTC",
 * which would land in tomorrow at 04:30 IST in some edge cases).
 *
 * Implementation: convert UTC → IST, add days in IST, convert back to UTC.
 */
export function addDaysIst(date: Date, days: number): Date {
  const zoned = toZonedTime(date, TIMEZONE);
  const incremented = addDaysUtc(zoned, days);
  return fromZonedTime(incremented, TIMEZONE);
}

/**
 * Forgiving parser for the common shapes we'll see in user input + admin
 * imports. Returns a UTC Date or throws.
 *
 * - ISO 8601 with or without timezone → parsed directly.
 * - "YYYY-MM-DD" (no time) → midnight IST.
 * - "DD/MM/YYYY" → midnight IST (Indian convention).
 *
 * Unknown shapes throw — callers should validate with Zod first.
 */
export function parseDate(input: string): Date {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('parseDate: empty input');

  // DD/MM/YYYY → reformat to YYYY-MM-DD before parseISO.
  const ddmmyyyy = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    return fromIstInput(`${yyyy}-${mm}-${dd}`);
  }

  // ISO-like (with or without time) — let parseISO try it.
  const parsed = parseISO(trimmed.replace(' ', 'T'));
  if (!Number.isNaN(parsed.getTime())) {
    // If the input had no timezone marker, treat it as IST wall clock.
    const hasTzMarker = /[zZ]|[+-]\d{2}:?\d{2}$/.test(trimmed);
    return hasTzMarker ? parsed : fromZonedTime(parsed, TIMEZONE);
  }

  throw new Error(`parseDate: cannot parse "${input}"`);
}

// =============================================================================
// HVA-289: financial-year helpers (FY = Apr 1 → Mar 31)
// =============================================================================
//
// The Beakn financial year runs April 1 → March 31. Every dashboard
// "Overall" view scopes to the current financial year to date. These are
// pure IST `YYYY-MM-DD` string operations — they take the IST date string
// (from getIstDateString()) so they share the same clock as the metric
// loaders, no Date/timezone round-trips. FY2026 = Apr 1 2026 → Mar 31 2027.
// =============================================================================

/** Calendar year the financial year containing `istDate` started in.
 *  Jan–Mar belong to the FY that started the previous April. */
export function financialYearStartYear(istDate: string): number {
  const [year, month] = istDate.split('-').map(Number);
  return month >= 4 ? year : year - 1;
}

/** Inclusive `YYYY-MM-DD` bounds of the financial year containing `istDate`. */
export function financialYearBounds(istDate: string): {
  start: string;
  end: string;
} {
  const sy = financialYearStartYear(istDate);
  return { start: `${sy}-04-01`, end: `${sy + 1}-03-31` };
}

/** Financial-year-to-date window: FY start → the given day (inclusive).
 *  This is the default range for every "Overall" dashboard tab. */
export function financialYearToDate(istToday: string): {
  fromDate: string;
  toDate: string;
} {
  return { fromDate: financialYearBounds(istToday).start, toDate: istToday };
}

/** Human label for the financial year containing `istDate`, e.g. "FY 2026–27". */
export function financialYearLabel(istDate: string): string {
  const sy = financialYearStartYear(istDate);
  return `FY ${sy}–${String(sy + 1).slice(2)}`;
}
