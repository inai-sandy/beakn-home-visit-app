// HVA-64: derive a single-glance verdict (🟢 / 🟡 / 🔴) for the Close the Day
// sticky header from the 6 target metrics. Pure helper — no DB.
//
// Rule:
//   - count of target cells whose status is 'green' or 'exceeded'  → "hits"
//   - count of target cells whose status is 'no_target'             → "untargeted"
//
// Verdict mapping (over the configured targets, ignoring untargeted):
//   - ≥ 4 hits OR (configured == 0 AND any positive actual movement) → 'green'
//   - ≥ 2 hits                                                       → 'yellow'
//   - otherwise                                                       → 'red'
//
// The placeholder one-liner is a deterministic shape — real AI coaching
// lands in Phase 3 per the ticket.

import type { DayCloseMetrics } from './metrics';

export type VerdictKind = 'green' | 'yellow' | 'red';

export interface DayVerdict {
  kind: VerdictKind;
  headline: string;
  oneLiner: string;
}

function formatRupees(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export function computeDayVerdict(metrics: DayCloseMetrics): DayVerdict {
  const targetCells = Object.values(metrics.targets);
  let hits = 0;
  let configured = 0;
  for (const cell of targetCells) {
    if (cell.status === 'no_target') continue;
    configured += 1;
    if (cell.status === 'green') hits += 1;
  }

  // Headline: pick the most user-meaningful achievement to lead with.
  // Order of preference: revenue (₹), orders, visits, tasks done. Fall
  // back to "Day summary" if everything is zero.
  let headline = 'Day summary';
  if (metrics.amountCollectedPaise > 0) {
    headline = `${formatRupees(metrics.amountCollectedPaise)} collected`;
  } else if (metrics.targets.orders.actual && metrics.targets.orders.actual > 0) {
    const n = metrics.targets.orders.actual;
    headline = `${n} order${n === 1 ? '' : 's'} closed`;
  } else if (metrics.targets.visits.actual && metrics.targets.visits.actual > 0) {
    const n = metrics.targets.visits.actual;
    headline = `${n} visit${n === 1 ? '' : 's'} done`;
  } else if (metrics.taskCounts.done > 0) {
    const total =
      metrics.taskCounts.done +
      metrics.taskCounts.postponed +
      metrics.taskCounts.pending;
    headline = `${metrics.taskCounts.done}/${total} task${total === 1 ? '' : 's'} done`;
  }

  let kind: VerdictKind;
  if (configured === 0) {
    // No targets configured anywhere. Use the variance signal alone.
    if (metrics.variancePct !== null && metrics.variancePct >= 80) {
      kind = 'green';
    } else if (
      metrics.amountCollectedPaise > 0 ||
      metrics.taskCounts.done > 0
    ) {
      kind = 'yellow';
    } else {
      kind = 'red';
    }
  } else if (hits >= 4 || hits / configured >= 0.66) {
    kind = 'green';
  } else if (hits >= 2 || hits / configured >= 0.33) {
    kind = 'yellow';
  } else {
    kind = 'red';
  }

  const oneLinerByKind: Record<VerdictKind, string> = {
    green: 'Strong day. Targets hit across the board.',
    yellow: 'Mixed day. Some targets hit, others to revisit.',
    red: 'Tough day. Most targets missed — review tomorrow.',
  };
  return { kind, headline, oneLiner: oneLinerByKind[kind] };
}
