-- BUG 8 (2026-06-03): each sales executive belongs to exactly ONE city.
--
-- Previously the schema only modelled `sales_executives.captain_user_id`
-- and execs were implicitly "in all cities their captain owns". That
-- over-counted in per-city admin tiles whenever a captain owned more
-- than one city — Sandeep flagged the exec-roster duplication 2026-06-02
-- in the dashboard audit.
--
-- Migration:
--   1. Add `city_id` column (nullable initially so the backfill can run).
--   2. Backfill: for execs whose captain owns exactly ONE city, set
--      city_id = that single city. Multi-city captains leave NULL;
--      admin will assign via the executives settings page.
--   3. Index for the per-city aggregation queries that will swap from
--      the captain-cities hop to a direct city_id filter.
--
-- We do NOT mark the column NOT NULL — backfill can produce NULL rows
-- for multi-city captains, and the form layer enforces required-ness
-- on new inserts. A future migration can flip NOT NULL once the
-- existing NULL rows are resolved by admin.

ALTER TABLE sales_executives
  ADD COLUMN city_id UUID
  REFERENCES cities(id) ON DELETE SET NULL;

-- Backfill: execs whose captain owns exactly 1 city → set city_id to that.
UPDATE sales_executives se
SET city_id = c.id
FROM cities c
WHERE c.captain_user_id = se.captain_user_id
  AND (
    SELECT COUNT(*) FROM cities c2
    WHERE c2.captain_user_id = se.captain_user_id
  ) = 1;

CREATE INDEX sales_executives_city_idx ON sales_executives (city_id);
