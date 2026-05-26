-- =============================================================================
-- PR10: scheduled exec unavailability
-- =============================================================================
--
-- Today, sales_executives.is_unavailable is a single boolean — captain
-- has to flip it daily for vacations / half-days / weekly offs. This
-- migration adds a date-range schedule table so the captain can set
-- unavailability ahead of time. Queries that resolve "is this exec
-- unavailable today" now check BOTH the boolean flag AND the schedule.
--
-- Schema:
--   exec_unavailability_schedules (
--     id                  uuid PK (uuid_generate_v7)
--     exec_user_id        uuid FK users.id ON DELETE CASCADE
--     start_date          date NOT NULL
--     end_date            date NOT NULL (inclusive)
--     reason              text NULL (≤200 chars, app-side cap)
--     created_by_user_id  uuid NULL FK users.id ON DELETE SET NULL
--     created_at, updated_at
--   )
--
-- Index pattern: (exec_user_id, start_date, end_date) covers the
-- "is this exec scheduled-unavailable today" lookup and the per-exec
-- list of upcoming windows. Sequential-scan after that is fine — bulk
-- size is small per exec.
--
-- audit_enabled_events gets two new entries:
--   - exec_unavailability_scheduled
--   - exec_unavailability_schedule_removed
-- The dual-write pattern (config row + lib/config-schema.ts defaults)
-- is preserved.
-- =============================================================================

CREATE TABLE IF NOT EXISTS exec_unavailability_schedules (
  id                 uuid        PRIMARY KEY DEFAULT uuid_generate_v7(),
  exec_user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date         date        NOT NULL,
  end_date           date        NOT NULL,
  reason             text,
  created_by_user_id uuid                 REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exec_unavailability_schedules_dates_chk CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS exec_unavailability_schedules_lookup_idx
  ON exec_unavailability_schedules (exec_user_id, start_date, end_date);

-- Audit events — append idempotently.
UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v ORDER BY v))
  FROM (
    SELECT jsonb_array_elements_text(c.value) AS v
    FROM config c
    WHERE c.key = 'audit_enabled_events'
    UNION SELECT 'exec_unavailability_scheduled'
    UNION SELECT 'exec_unavailability_schedule_removed'
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
