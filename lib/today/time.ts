import { toZonedTime } from 'date-fns-tz';

// =============================================================================
// HVA-60: time helpers for the today-loop bundle
// =============================================================================
//
// The exec-facing daily loop is wholly IST. All "today" comparisons compute
// the IST calendar date so a 22:00 UTC mutation (= 03:30 IST next day)
// doesn't get filed under the previous IST day. `getIstDateString()` is the
// single source of truth for "what day is it"; everything else flows from
// it.
//
// estimated_time / actual_time on tasks are stored as varchar(32) buckets —
// '15min' / '30min' / '1hr' / '2hr' / '3hr+'. parseEstimatedMinutes parses
// the bucket back to an integer minute count for math (fast-completion
// flag, traffic-light comparisons). formatMinutesAsBucket goes the other
// way for the `actual_time` write when a task is marked done.
// =============================================================================

const IST_TZ = 'Asia/Kolkata';

/**
 * Returns the current IST calendar date as YYYY-MM-DD.
 * Pass an explicit `now` for testing; defaults to `new Date()` in callers.
 */
export function getIstDateString(now: Date = new Date()): string {
  const zoned = toZonedTime(now, IST_TZ);
  const y = zoned.getFullYear();
  const m = String(zoned.getMonth() + 1).padStart(2, '0');
  const d = String(zoned.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns true iff the IST wall-clock time of `now` is at or past `targetHHMM`.
 * `targetHHMM` is `HH:MM` 24h (the CONFIG_SCHEMA shape for day_close_target_time).
 */
export function isAtOrAfterIstTime(now: Date, targetHHMM: string): boolean {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(targetHHMM);
  if (!match) return false; // malformed target → behave like "not yet"; caller already validated upstream
  const targetHours = Number(match[1]);
  const targetMinutes = Number(match[2]);
  const zoned = toZonedTime(now, IST_TZ);
  const nowMins = zoned.getHours() * 60 + zoned.getMinutes();
  const targetMins = targetHours * 60 + targetMinutes;
  return nowMins >= targetMins;
}

// -----------------------------------------------------------------------------
// estimated_time bucket parsing
// -----------------------------------------------------------------------------

export const ESTIMATED_TIME_BUCKETS = ['15min', '30min', '1hr', '2hr', '3hr+'] as const;
export type EstimatedTimeBucket = (typeof ESTIMATED_TIME_BUCKETS)[number];

const BUCKET_TO_MINUTES: Record<EstimatedTimeBucket, number> = {
  '15min': 15,
  '30min': 30,
  '1hr': 60,
  '2hr': 120,
  '3hr+': 180,
};

/**
 * Parses a stored estimated_time / actual_time bucket back to an integer
 * minute count. Returns null on null/unknown input — callers must handle
 * the null case (skip the fast-completion flag, etc.).
 */
export function parseEstimatedMinutes(stored: string | null | undefined): number | null {
  if (stored == null) return null;
  if (stored in BUCKET_TO_MINUTES) {
    return BUCKET_TO_MINUTES[stored as EstimatedTimeBucket];
  }
  return null;
}

/**
 * Maps an absolute minute count back to the closest <=-bucket (so a 2hr
 * 5min actual lands on '2hr', not '3hr+'). Used when writing `actual_time`
 * during Mark as Done. 180+ minutes → '3hr+'.
 */
export function formatMinutesAsBucket(mins: number): EstimatedTimeBucket {
  if (!Number.isFinite(mins) || mins <= 0) return '15min';
  if (mins < 30) return '15min';
  if (mins < 60) return '30min';
  if (mins < 120) return '1hr';
  if (mins < 180) return '2hr';
  return '3hr+';
}

/**
 * Returns true iff `actualBucket` represents materially less time than
 * `estimatedBucket × 0.3`. Used by HVA-64 to flag suspiciously fast
 * completions. Null on either side returns false (no flag).
 */
export function isFastCompletion(
  estimatedBucket: string | null,
  actualBucket: string | null,
): boolean {
  const est = parseEstimatedMinutes(estimatedBucket);
  const act = parseEstimatedMinutes(actualBucket);
  if (est === null || act === null) return false;
  return act < est * 0.3;
}
