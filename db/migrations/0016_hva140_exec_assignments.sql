-- =============================================================================
-- HVA-140: request_exec_assignments — captain-driven reassignment trail
-- =============================================================================
--
-- Captures every (from_exec → to_exec) handoff a captain (or super_admin)
-- triggers on a request, with the captain's mandatory reason. Distinct
-- from request_status_history because reassignment does NOT change the
-- request's status_stage_id — the flow continues from where the previous
-- exec left it.
--
-- from_exec_user_id is nullable because a future "initial assign via
-- this table" path (or super_admin retroactive backfill) might want to
-- record an assignment with no predecessor. Today's HVA-140 ship always
-- writes a non-null value (current assigned exec → new exec).
--
-- Index supports the customer tracking page's per-request lookup ordered
-- newest-first. Other consumers (audit / admin dashboard) can rely on
-- audit_log for cross-request queries.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS guards re-runs.
-- =============================================================================

CREATE TABLE IF NOT EXISTS request_exec_assignments (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  request_id         uuid NOT NULL REFERENCES visit_requests(id) ON DELETE CASCADE,
  from_exec_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  to_exec_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  captain_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason             text NOT NULL,
  created_at         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT request_exec_assignments_reason_length
    CHECK (char_length(reason) BETWEEN 50 AND 500)
);

CREATE INDEX IF NOT EXISTS idx_request_exec_assignments_request_created
  ON request_exec_assignments (request_id, created_at DESC);
