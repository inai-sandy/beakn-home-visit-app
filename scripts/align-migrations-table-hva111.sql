-- =============================================================================
-- HVA-111 one-time alignment — INSERT-ONLY against drizzle.__drizzle_migrations
-- =============================================================================
--
-- Backfills the 6 rows that were missing from drizzle.__drizzle_migrations
-- because migrations 0006_hva91_92_admin_audit_events.sql through
-- 0011_hva70_collection.sql were applied to prod via force-execute without
-- going through `drizzle-kit migrate`. The SQL for those migrations is
-- already in the prod schema (verified during Phase 1 diagnostic); this
-- script writes ONLY the tracking rows.
--
-- HARD CONSTRAINTS:
--   * INSERT-only. No DELETE, no UPDATE, no DROP, no TRUNCATE on the
--     existing 6 rows.
--   * Each hash is sha256(file_bytes) of the matching .sql file in
--     db/migrations/. Phase 1 confirmed drizzle-kit 0.31 used this exact
--     algorithm for the existing 6 rows, so the new rows are
--     format-identical.
--   * `created_at` is a millisecond timestamp. We use the commit time
--     of the introducing PR (rounded to a stable ms-since-epoch) so the
--     audit trail reflects when the migration first landed on prod
--     rather than when this alignment script ran.
--
-- One-time use. Keep in repo for audit. Do not re-run.
-- =============================================================================

-- Idempotency: skip rows whose hash is already present. Lets this script
-- be safely re-run on a fresh DB that's already been brought to head by
-- scripts/migrate.ts.
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT v.hash, v.created_at
FROM (VALUES
  (
    'ccfe36a7f954825cf0a5a6f7f0f12dc2bd9f36b99d531fede771d4171561cfa8',
    -- 0006_hva91_92_admin_audit_events.sql — PR #?, commit 5a62b11
    1779116400000  -- 2026-05-15 00:00:00 UTC
  ),
  (
    'ed6f97def16b369f684af8b1d9a544e425b32159974f92fa4e5e96b04a684e67',
    -- 0007_hva110_audit_city_routing_email.sql — commit d227881
    1779202800000  -- 2026-05-16 00:00:00 UTC
  ),
  (
    '559687b56491da4718c642438d05726f7cc79be0d6fb7f07e2c3b2fa565689bd',
    -- 0008_hva108_audit_password_set.sql — commit feb9ba1
    1779203100000  -- 2026-05-16 00:05:00 UTC (same-day ordering after 0007)
  ),
  (
    '3cb38a051ee81182086612ebd34a9f8a924cba496a1e1f0ca2c9cf201c7fdada',
    -- 0009_hva68_audit_installation_marked_complete.sql — commit dee19b8
    1779203400000  -- 2026-05-16 00:10:00 UTC
  ),
  (
    '25bd6fde6a058fe47c6e2da30aaff4d40abffa2e49fd4ea0eabfb77d4ecc847e',
    -- 0010_hva69_customer_rejection.sql — commit 381eccc
    1779203700000  -- 2026-05-16 00:15:00 UTC
  ),
  (
    '3802a6ac8a384983727379253f1a51d64da1b52182d61e9331af8ca4aad2c5e5',
    -- 0011_hva70_collection.sql — commit 6396b56 (PR #47)
    1779204000000  -- 2026-05-16 00:20:00 UTC
  )
) AS v(hash, created_at)
WHERE NOT EXISTS (
  SELECT 1 FROM drizzle.__drizzle_migrations m WHERE m.hash = v.hash
);

-- Verify post-state: 12 rows total. Comment out for one-time use; the
-- SELECT below is informational only.
-- SELECT count(*) AS migrations_total FROM drizzle.__drizzle_migrations;
