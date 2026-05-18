-- HVA-73: Lead → Request conversion needs a timestamp column to record
-- when the conversion happened (sister to `converted_to_request_id` which
-- the initial schema migration 0000 already shipped). Add it nullable —
-- it's only set when the lead converts.
ALTER TABLE "leads" ADD COLUMN "converted_at" timestamp with time zone;

-- HVA-73 / spec §6: business lead type requires a business_type FK.
-- `business_types` was created empty in the initial schema; seed the 5
-- canonical values here so the Add Lead form's dropdown is populated.
-- ON CONFLICT DO NOTHING — re-running on an already-seeded DB is a no-op.
INSERT INTO business_types (code, name, sequence_number, is_active) VALUES
  ('interior_designer',     'Interior Designer',     1, true),
  ('electrical_consultant', 'Electrical Consultant', 2, true),
  ('contractor',            'Contractor',            3, true),
  ('architect',             'Architect',             4, true),
  ('other',                 'Other',                 5, true)
ON CONFLICT (code) DO NOTHING;

-- HVA-74: extend audit_enabled_events with the lead-conversion event so
-- the audit_log row written by convertLeadToRequestAction actually
-- persists on running prod. Same dual-write pattern as HVA-137
-- (lib/config-schema.ts carries the default for fresh DBs / tests;
-- this migration patches the live row). array_agg(DISTINCT) collapses
-- re-runs into a no-op.
UPDATE config
SET value = (
  SELECT to_jsonb(array_agg(DISTINCT v))
  FROM (
    SELECT jsonb_array_elements_text(c.value::jsonb) AS v
      FROM config c
     WHERE c.key = 'audit_enabled_events'
    UNION
    SELECT 'lead_converted_to_request'
  ) merged
),
updated_at = now()
WHERE key = 'audit_enabled_events';
