import postgres from 'postgres';

// =============================================================================
// HVA-198: per-test DB reset helper
// =============================================================================
//
// Playwright runs all desktop tests, then all tablet, then all mobile
// (workers: 1, fullyParallel: false — required for stable baselines).
// Tests that mutate state (e.g. Start My Day) leave that state behind
// for the next viewport's run of the same spec, which can flip the
// post-login destination or break a "fresh exec" assumption.
//
// `resetExecState(userId)` deletes today's day_plan + any tasks the
// exec owns so the next test starts from a known-empty state. The
// DATABASE_URL pointing at the e2e testcontainer is exported from
// scripts/run-e2e.ts via env, so this helper reads it at call time.
//
// Deleting test rows in a per-run testcontainer is fine — CLAUDE.md's
// "no deletes" rule applies to production code only.
// =============================================================================

function dbUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL not set — run via `pnpm test:e2e`.');
  }
  return url;
}

export async function resetExecState(execUserId: string): Promise<void> {
  const sql = postgres(dbUrl(), { max: 1, onnotice: () => {} });
  try {
    // Tasks first (FK to day_plans is ON DELETE SET NULL, but easier
    // to just clear the exec's tasks for the run).
    await sql`DELETE FROM tasks WHERE exec_user_id = ${execUserId}`;
    await sql`DELETE FROM day_plans WHERE exec_user_id = ${execUserId}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
