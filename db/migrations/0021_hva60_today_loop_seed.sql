-- HVA-60: seed the today-loop reference data.
--
-- Three idempotent INSERT blocks. Each uses ON CONFLICT … DO NOTHING so
-- re-running this migration on an already-seeded DB is a no-op, matching
-- the HVA-33 / HVA-67 conventions for seed migrations.
--
-- Spec deviation logged (Δ4 from HVA-60 Step 0 recon):
--   tasks.estimated_time is NOT NULL in the schema. The HVA-60 bundle
--   text said "estimated_time optional" in the Add Task form, but the
--   schema forbids null. The AddTaskSheet form therefore makes the
--   field required, defaulting the user's selection to '30min'. Future
--   ticket to either relax the column or formally re-spec the field.
--
-- task_type enum values (Δ2): the pgEnum stores Title Case strings with
-- spaces — 'Sales pitch', 'Customer home visit', 'Follow-up',
-- 'Installation & Activation', 'Outlet visit', 'Stall Activity', 'Other'.
-- outcome_options.task_type rows below use those exact values. The
-- outcome_options.code column stays snake_case (machine-friendly id).
--
-- task.status writes (Δ1): the schema enum value for "done" is actually
-- 'completed'. UI labels say "Done"; the DB stores 'completed'. The
-- 'cancelled' enum value remains unused — no UI path writes it.

-- =============================================================================
-- 1. outcome_options — chips per task_type per spec §10.5
-- =============================================================================
-- Sales pitch chips
INSERT INTO outcome_options (task_type, code, name, sequence_number, is_active) VALUES
  ('Sales pitch', 'quote_sent',       'Quote sent',       1, true),
  ('Sales pitch', 'order_closed',     'Order closed',     2, true),
  ('Sales pitch', 'follow_up_needed', 'Follow-up needed', 3, true),
  ('Sales pitch', 'walked_away',      'Walked away',      4, true)
ON CONFLICT (task_type, code) DO NOTHING;

-- Customer home visit chips (same 4 codes/names as Sales pitch per spec)
INSERT INTO outcome_options (task_type, code, name, sequence_number, is_active) VALUES
  ('Customer home visit', 'quote_sent',       'Quote sent',       1, true),
  ('Customer home visit', 'order_closed',     'Order closed',     2, true),
  ('Customer home visit', 'follow_up_needed', 'Follow-up needed', 3, true),
  ('Customer home visit', 'walked_away',      'Walked away',      4, true)
ON CONFLICT (task_type, code) DO NOTHING;

-- Follow-up chips
INSERT INTO outcome_options (task_type, code, name, sequence_number, is_active) VALUES
  ('Follow-up', 'conversion', 'Conversion', 1, true),
  ('Follow-up', 'reschedule', 'Reschedule', 2, true),
  ('Follow-up', 'lost',       'Lost',       3, true)
ON CONFLICT (task_type, code) DO NOTHING;

-- Installation & Activation chips
INSERT INTO outcome_options (task_type, code, name, sequence_number, is_active) VALUES
  ('Installation & Activation', 'completed', 'Completed', 1, true),
  ('Installation & Activation', 'partial',   'Partial',   2, true),
  ('Installation & Activation', 'blocked',   'Blocked',   3, true)
ON CONFLICT (task_type, code) DO NOTHING;

-- NOTE: Outlet visit / Stall Activity / Other intentionally have no rows
-- here. Those task types use a free-text outcome (textarea + Confirm)
-- per spec §10.5, not chips.

-- =============================================================================
-- 2. postpone_reasons — spec §10.6
-- =============================================================================
INSERT INTO postpone_reasons (code, name, sequence_number, is_active) VALUES
  ('customer_unavailable',    'Customer unavailable',     1, true),
  ('vehicle_transport',       'Vehicle/transport issue',  2, true),
  ('personal_emergency',      'Personal emergency',       3, true),
  ('awaiting_customer_input', 'Awaiting customer input',  4, true),
  ('other',                   'Other',                    5, true)
ON CONFLICT (code) DO NOTHING;

-- =============================================================================
-- 3. config — 6 daily-target keys (Close the Day metrics, HVA-64)
-- =============================================================================
-- CONFIG_SCHEMA in lib/config-schema.ts already registers these keys with
-- type=number, category='targets', min=0. The INSERT below seeds the
-- defaults that match CONFIG_SCHEMA.defaultValue verbatim. config.value
-- is jsonb NOT NULL — the value column stores the number as-is.
INSERT INTO config (key, category, description, value) VALUES
  (
    'target_daily_revenue',
    'targets',
    'Daily revenue target per exec (₹). Drives the green/yellow/red badge on the Close the Day screen.',
    '50000'::jsonb
  ),
  (
    'target_daily_visits',
    'targets',
    'Daily completed-visit target per exec. Counts customer_home_visit + sales_pitch + outlet_visit tasks marked done today.',
    '5'::jsonb
  ),
  (
    'target_daily_quotations',
    'targets',
    'Daily quotations-submitted target per exec. Counts quotations whose submitted_at falls on the current day.',
    '3'::jsonb
  ),
  (
    'target_daily_orders',
    'targets',
    'Daily orders-closed target per exec. Counts visit_requests transitioned to ORDER_CONFIRMED or ORDER_EXECUTED_SUCCESSFULLY by the exec today.',
    '1'::jsonb
  ),
  (
    'target_daily_conversion_pct',
    'targets',
    'Daily conversion percent target per exec (orders / visits × 100). Null if visits=0; that hides the badge entirely.',
    '30'::jsonb
  ),
  (
    'target_daily_task_completion_pct',
    'targets',
    'Daily task-completion percent target per exec (done / (done + postponed + pending) × 100).',
    '80'::jsonb
  )
ON CONFLICT (key) DO NOTHING;
