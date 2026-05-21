-- =============================================================================
-- HVA-169: tasks.rolled_over_at — Pending-Tasks-across-days roll-over support
-- =============================================================================
--
-- Adds a nullable timestamptz column that the 9:31 PM IST cron stamps on
-- tasks left in `status='pending'` after their `task_date` passed. The cron
-- preserves `task_date` (audit trail) and only flips `rolled_over_at`; the
-- exec dashboard then surfaces these tasks in the Pending accordion with a
-- "Rolled over from <date>" pill.
--
-- Captain red-flag (see lib/captain/dashboard-queries.ts.loadTeamExecStatuses):
--   a task with `rolled_over_at < NOW() - INTERVAL '3 days'` raises the flag
--   so captains see staleness without scanning per-exec tasklists.
--
-- Index: partial covering the dashboard query
--   `WHERE exec_user_id = ? AND status='pending' AND rolled_over_at IS NOT NULL`
-- Selectivity is tight (mostly-empty partial index) so the cost is trivial.
-- =============================================================================

ALTER TABLE tasks
  ADD COLUMN rolled_over_at TIMESTAMPTZ NULL;

CREATE INDEX tasks_rolled_over_idx
  ON tasks(exec_user_id, status)
  WHERE status = 'pending' AND rolled_over_at IS NOT NULL;
