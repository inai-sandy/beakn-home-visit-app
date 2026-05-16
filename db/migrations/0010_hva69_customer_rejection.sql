-- HVA-69: customer rejection action — exec/captain/admin records the
-- customer's rejection on the request.
--
-- Reuses HVA-39's existing cancellation columns (cancelled_at,
-- cancellation_actor, cancelled_by_user_id, cancellation_reason). Adds
-- ONE new column for the typed enum reason code (the existing
-- cancellation_reason text column is repurposed as the optional
-- free-text note).
--
-- Allow-list adds 'customer_rejection_marked' so the audit row writes.
-- HVA-108 dual-write pattern: lib/config-schema.ts defaultValue gets
-- the same entry so the HVA-101 test container (which doesn't seed
-- the config row) also accepts it.
--
-- Idempotent. Re-running drops nothing.

ALTER TABLE visit_requests
  ADD COLUMN IF NOT EXISTS cancellation_reason_code varchar(64);

UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v))
  FROM (
    SELECT jsonb_array_elements_text(c.value::jsonb) AS v
      FROM config c
     WHERE c.key = 'audit_enabled_events'
    UNION
    SELECT unnest(ARRAY['customer_rejection_marked'])
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
