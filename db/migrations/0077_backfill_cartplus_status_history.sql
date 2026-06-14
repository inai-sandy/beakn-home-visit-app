-- HVA-287: backfill the missing initial status-history row for CartPlus
-- (source='portal') requests.
--
-- The create-new branch of handler-order-created.ts used to set
-- status_stage_id = QUOTATION_GIVEN directly without writing any
-- request_status_history row. The /requests + /track timeline is built
-- from history rows, so those requests rendered an empty ladder with the
-- synthetic "Submitted" wrongly flagged as the current stage.
--
-- This inserts one anchor row at each affected request's CURRENT stage
-- (from = null, transition_order = 1, changed_at = the request's creation
-- time, attributed to the assigned exec when present). Idempotent: only
-- touches portal requests that have zero history rows, so re-running is a
-- no-op. Append-only — matches the no-deletes / append-only history rule.

INSERT INTO request_status_history (
  request_id,
  from_status_stage_id,
  to_status_stage_id,
  sequence_number,
  transition_order,
  changed_by_user_id,
  reason,
  changed_at
)
SELECT
  vr.id,
  NULL,
  vr.status_stage_id,
  ss.sequence_number,
  1,
  vr.assigned_exec_user_id,
  'CartPlus order received (backfill)',
  vr.created_at
FROM visit_requests vr
JOIN status_stages ss ON ss.id = vr.status_stage_id
WHERE vr.source = 'portal'
  AND NOT EXISTS (
    SELECT 1 FROM request_status_history h WHERE h.request_id = vr.id
  );
