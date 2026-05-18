// =============================================================================
// HVA-60 / HVA-64: traffic-light comparison for daily target metrics
// =============================================================================
//
// Spec D6 thresholds:
//   actual >= target         → 🟢 green
//   actual >= target × 0.7   → 🟡 yellow
//   actual < target × 0.7    → 🔴 red
//   target missing or zero   → gray "no target set" (do NOT default)
//
// The gray bucket is intentional. A missing target shouldn't be silently
// substituted with a number — that would let a misconfigured deploy
// quietly hide its state from operators.
// =============================================================================

export type TargetStatus = 'green' | 'yellow' | 'red' | 'no_target';

export function compareToTarget(
  actual: number,
  target: number | null | undefined,
): TargetStatus {
  if (target == null || target <= 0) return 'no_target';
  if (actual >= target) return 'green';
  if (actual >= target * 0.7) return 'yellow';
  return 'red';
}

/**
 * A conversion percent target where the underlying denominator is zero
 * collapses to "no target" rather than the configured number — the
 * traffic light can't say anything meaningful about a ratio with no
 * data. Used by Close the Day's conversion_pct metric.
 */
export function compareConversionPct(
  ordersClosed: number,
  visitsCompleted: number,
  target: number | null | undefined,
): { actual: number | null; status: TargetStatus } {
  if (visitsCompleted === 0) {
    return { actual: null, status: 'no_target' };
  }
  const actual = (ordersClosed / visitsCompleted) * 100;
  return { actual, status: compareToTarget(actual, target) };
}
