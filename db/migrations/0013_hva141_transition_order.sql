-- =============================================================================
-- HVA-141: introduce transition_order on request_status_history
-- =============================================================================
--
-- Until this migration, sequence_number on a history row carried the
-- TARGET stage's sequence_number, and a UNIQUE (request_id,
-- sequence_number) constraint guaranteed each request visited each stage
-- at most once. That guard breaks for HVA-141's one-stage rollback,
-- because a rollback from seq N to seq N-1 needs a NEW history row that
-- collides with the existing forward row at N-1.
--
-- This migration separates the two concerns:
--   * sequence_number stays as the TARGET stage's seq (human-readable;
--     useful for `WHERE sequence_number = X` filters).
--   * transition_order becomes the monotonic per-request transition
--     counter and carries the UNIQUE.
--
-- Idempotent. Re-running is a no-op.
-- =============================================================================

-- 1. Add the new column with a temporary default so backfill is single-
--    statement. The DEFAULT is removed at the end of the migration.
ALTER TABLE request_status_history
  ADD COLUMN IF NOT EXISTS transition_order integer NOT NULL DEFAULT 0;

-- 2. Backfill: order existing rows by (changed_at, sequence_number) so
--    ties on the same instant remain deterministic. ROW_NUMBER() partitions
--    by request_id so each request gets its own 1..N sequence. Only touch
--    rows whose transition_order is still the default (re-run safe).
WITH ordered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY request_id
      ORDER BY changed_at, sequence_number
    ) AS new_order
  FROM request_status_history
)
UPDATE request_status_history rsh
   SET transition_order = ordered.new_order
  FROM ordered
 WHERE rsh.id = ordered.id
   AND rsh.transition_order = 0;

-- 3. Drop the old UNIQUE on (request_id, sequence_number). The index name
--    matches drizzle-kit's emission (`request_status_history_request_sequence_unique`).
--    Wrap in DO $$ so the migration is re-runnable after a successful
--    drop.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname = 'request_status_history_request_sequence_unique'
  ) THEN
    DROP INDEX request_status_history_request_sequence_unique;
  END IF;
END $$;

-- 4. Add the new UNIQUE on (request_id, transition_order). This is what
--    actually guards against concurrent double-writes for the same
--    logical transition.
CREATE UNIQUE INDEX IF NOT EXISTS request_status_history_request_transition_order_unique
  ON request_status_history (request_id, transition_order);

-- 5. Drop the temporary default so future inserts must supply the
--    transition_order explicitly (the application layer computes it as
--    MAX(transition_order) + 1 inside the same tx).
ALTER TABLE request_status_history
  ALTER COLUMN transition_order DROP DEFAULT;
