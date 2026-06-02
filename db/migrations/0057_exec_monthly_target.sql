-- Monthly sales-executive target — common across all execs, all cities.
--
-- Two parallel meters track this number on the exec dashboard:
--   1. ORDER_CONFIRMED orders attributed to the assignee at the moment
--      of the transition (attribution-vs-action-taker principle).
--   2. Inbound payments attributed to the visit_request's currently
--      assigned exec.
--
-- Calendar month IST boundaries. Default ₹7L = 70_000_000 paise; admin
-- can edit via /admin/settings/targets/monthly.
--
-- Idempotent. ON CONFLICT preserves any prior admin tuning.

INSERT INTO config (key, category, description, value) VALUES
  (
    'monthly_exec_target_paise',
    'targets',
    'Monthly sales target per executive in paise (₹7L = 70000000). The exec dashboard tracks both confirmed-order value AND inbound revenue against this number.',
    '70000000'::jsonb
  )
ON CONFLICT (key) DO NOTHING;
