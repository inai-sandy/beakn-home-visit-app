-- =============================================================================
-- HVA-73 PR 2: extend audit_enabled_events with request_contact_linked
-- =============================================================================
--
-- Captain assignments now run a find-or-create-contact step (lib/captain/
-- contact-linker.ts) that links the freshly-assigned visit_request to a
-- leads row (existing or newly created). We log a single audit event,
-- `request_contact_linked`, with afterState distinguishing the create
-- path (afterState.created = true) from the link-to-existing path
-- (created = false).
--
-- Same dual-write pattern as 0022: lib/config-schema.ts carries the
-- default for fresh DBs / tests; this migration patches the live row.
-- array_agg(DISTINCT) collapses re-runs into a no-op.
--
-- No schema changes — visit_requests.contact_id already shipped in
-- migration 0023.
-- =============================================================================

UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v ORDER BY v))
  FROM (
    SELECT jsonb_array_elements_text(c.value) AS v
    FROM config c
    WHERE c.key = 'audit_enabled_events'
    UNION
    SELECT 'request_contact_linked'
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
