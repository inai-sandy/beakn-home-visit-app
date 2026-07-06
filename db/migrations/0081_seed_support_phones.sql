-- Seed the two support-contact phone keys (lib/config-schema.ts).
--
-- `customer_support_phone` and `admin_support_phone` ship with empty-string
-- defaults in CONFIG_SCHEMA but were never seeded into the config table. As a
-- result:
--   - the public /track page fell back to a hard-coded demo number, and
--   - the forgot-password screen showed no contact at all.
--
-- Seed BOTH with the real support line. The value column is JSONB and
-- getConfig() reads it back as a JSON-decoded string, so string values are
-- stored JSON-encoded (i.e. quoted): '"+919701278976"'::jsonb.
--
-- Idempotent + non-destructive: ON CONFLICT (key) DO NOTHING never overwrites
-- a value an admin has already tuned via /admin/settings.

INSERT INTO config (key, category, description, value) VALUES
  (
    'customer_support_phone',
    'organization',
    'Customer-facing support phone number. Shown on the public tracking page and in customer-facing notification templates.',
    '"+919701278976"'::jsonb
  ),
  (
    'admin_support_phone',
    'organization',
    'Internal admin/exec support phone number. Shown in exec-side help screens (Admin Help fallback).',
    '"+919701278976"'::jsonb
  )
ON CONFLICT (key) DO NOTHING;
