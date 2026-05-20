-- =============================================================================
-- HVA-162: index request_exec_assignments for the exec visibility hot path
-- =============================================================================
--
-- visit_requests.assigned_exec_user_id and assigned_captain_user_id are
-- ALREADY indexed since the initial schema (0000_initial_schema.sql).
-- The original ticket assumed they weren't; PR 92's EXPLAIN ANALYZE at
-- 11 rows showed seq scans because the planner correctly skipped the
-- existing indexes at that size — not because they were missing.
--
-- The real scaling lever is request_exec_assignments. Today it only has
-- a composite (request_id, created_at DESC). PR 92 Q3 EXPLAIN ANALYZE
-- showed a Seq Scan with `Filter: (to_exec_user_id = … OR
-- from_exec_user_id = …)` — that's what `loadExecVisibleContactSet`'s
-- historical-reassignment branch hits on every /leads load, every
-- /today linkable picker, and every contact-detail page.
--
-- Two single-column btree indexes match the OR-filter pattern. The
-- planner will pick one (or a bitmap OR over both) once row counts
-- justify it.
-- =============================================================================

CREATE INDEX IF NOT EXISTS request_exec_assignments_to_exec_idx
  ON request_exec_assignments (to_exec_user_id);

CREATE INDEX IF NOT EXISTS request_exec_assignments_from_exec_idx
  ON request_exec_assignments (from_exec_user_id);
