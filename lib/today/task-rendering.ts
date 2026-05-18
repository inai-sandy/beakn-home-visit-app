// =============================================================================
// HVA-60: pure helpers for task list rendering decisions
// =============================================================================
//
// Lives in /lib so vitest can import without bringing the React tree.
// Used by app/(exec)/today/_components/* — and by the test suite to lock
// the chip-vs-free-text decision against the actual pgEnum values (Δ12
// anti-regression).
// =============================================================================

export const CHIP_TASK_TYPES = [
  'Sales pitch',
  'Customer home visit',
  'Follow-up',
  'Installation & Activation',
] as const;

export const FREE_TEXT_TASK_TYPES = [
  'Outlet visit',
  'Stall Activity',
  'Other',
] as const;

export type TaskDisplayMode = 'chips' | 'free_text';

/**
 * Decides whether the Mark As Done flow renders an outcome chip row OR a
 * free-text outcome textarea for a given task_type. Unrecognised
 * task_type values default to 'free_text' (fail toward "exec can still
 * record an outcome").
 */
export function resolveTaskDisplayMode(taskType: string): TaskDisplayMode {
  if ((CHIP_TASK_TYPES as readonly string[]).includes(taskType)) return 'chips';
  if ((FREE_TEXT_TASK_TYPES as readonly string[]).includes(taskType)) return 'free_text';
  return 'free_text';
}

/**
 * Returns true iff `taskType` matches an entry in the schema's pgEnum.
 * Used by the anti-regression test (Test #12) to lock that every chip
 * code path here matches what the DB will accept.
 */
export const KNOWN_TASK_TYPES = [
  ...CHIP_TASK_TYPES,
  ...FREE_TEXT_TASK_TYPES,
] as const;

/**
 * Picks the next task to surface. "Oldest pending by createdAt asc" —
 * the page query already orders ASC, so the find() returns the right
 * row. Returns null when there are no pending tasks (all done /
 * postponed / empty list).
 */
export interface NextTaskCandidate {
  id: string;
  status: string;
  createdAt: string | Date;
}

export function pickNextTask<T extends NextTaskCandidate>(tasks: readonly T[]): T | null {
  let best: T | null = null;
  let bestAt = Number.POSITIVE_INFINITY;
  for (const t of tasks) {
    if (t.status !== 'pending') continue;
    const ts =
      typeof t.createdAt === 'string'
        ? Date.parse(t.createdAt)
        : t.createdAt.getTime();
    if (ts < bestAt) {
      best = t;
      bestAt = ts;
    }
  }
  return best;
}
