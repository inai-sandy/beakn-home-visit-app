-- =============================================================================
-- HVA-325: record and announce a CartPlus order edit after Order Confirmed
-- =============================================================================
--
-- Clicking Order Confirmed in the portal locks nothing in CartPlus — Beakn
-- makes zero outbound calls. The order stays editable there, and every edit
-- rewrites our quotation total and line items with no regard for how far the
-- request has travelled. It works the same at Order Confirmed, at
-- Installation Scheduled, and at Order Executed.
--
-- Nothing recorded it and nobody was told. Production has five orders whose
-- value changed mid-flight, one of them ₹4,174 → ₹8,354 a minute before it
-- was confirmed. The only trace on screen was a "last synced" timestamp.
--
-- Sandeep 2026-08-05: CartPlus already messages the customer about the edit;
-- our portal's job is the internal record. So this ships two things — a
-- notification, and a row that is still readable three days later when
-- someone asks why the value is not what they confirmed.
--
-- WHY A DEDICATED TABLE, not a request_status_history row:
--   apply-status.ts sets a precedent for a from=to history row (used on
--   cancel), and copying it would have been less code. But
--   request_status_history is read by ~30 call sites — conversion metrics,
--   leaderboards, target progress, lifecycle and geography reports, the
--   customer /track ladder. Injecting a new row KIND into a table that many
--   consumers infer meaning from is how a reporting bug gets shipped
--   silently. The timeline merges this table in as a third source instead,
--   which HVA-324 already made straightforward.
--
-- Append-only, in line with the project's no-deletes rule: a superseded
-- change is history, not a mistake to erase.
-- =============================================================================

CREATE TABLE IF NOT EXISTS request_order_changes (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),

  visit_request_id uuid NOT NULL
    REFERENCES visit_requests(id) ON DELETE CASCADE,
  quotation_id uuid NOT NULL
    REFERENCES quotations(id) ON DELETE CASCADE,
  -- Which delivery caused it. ON DELETE SET NULL because webhook_events is
  -- prunable audit data and losing it must not cost us the change record.
  webhook_event_id uuid
    REFERENCES webhook_events(id) ON DELETE SET NULL,

  -- Money, in paise, per the project rule. Both sides stored so the row
  -- reads on its own without replaying every prior change.
  previous_total_paise bigint NOT NULL,
  new_total_paise bigint NOT NULL,

  previous_item_count integer NOT NULL,
  new_item_count integer NOT NULL,

  -- Which kinds of edit this was. All three can be non-zero at once.
  items_added integer NOT NULL DEFAULT 0,
  items_removed integer NOT NULL DEFAULT 0,
  items_amended integer NOT NULL DEFAULT 0,

  -- The stage the request had reached when the edit landed. Denormalised
  -- deliberately: the whole point of the record is what was true AT THE
  -- TIME, and the request will have moved on by the time anyone reads it.
  stage_code varchar(64) NOT NULL,

  changed_at timestamptz NOT NULL DEFAULT NOW(),
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS request_order_changes_request_idx
  ON request_order_changes (visit_request_id);
CREATE INDEX IF NOT EXISTS request_order_changes_changed_at_idx
  ON request_order_changes (changed_at);

-- ---------------------------------------------------------------------------
-- Audit allow-list
-- ---------------------------------------------------------------------------

UPDATE config
SET value = CASE
  WHEN value ? 'cartplus_order_changed' THEN value
  ELSE value || '["cartplus_order_changed"]'::jsonb
END
WHERE key = 'audit_enabled_events';

-- ---------------------------------------------------------------------------
-- Notification rules
-- ---------------------------------------------------------------------------
-- Same audience and reasoning as HVA-326: internal only, because CartPlus
-- has already told the customer about their own edit. in_app + push; no
-- WhatsApp rule until its template exists (13 already sit disabled awaiting
-- Meta approval).

INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  ('webhook.cartplus.order_changed', 'in_app', 'exec_assigned',       TRUE, NULL),
  ('webhook.cartplus.order_changed', 'in_app', 'captain_owning_city', TRUE, NULL),
  ('webhook.cartplus.order_changed', 'in_app', 'support_team_all',    TRUE, NULL),
  ('webhook.cartplus.order_changed', 'in_app', 'super_admin',         TRUE, NULL),
  ('webhook.cartplus.order_changed', 'push',   'exec_assigned',       TRUE, NULL),
  ('webhook.cartplus.order_changed', 'push',   'captain_owning_city', TRUE, NULL),
  ('webhook.cartplus.order_changed', 'push',   'support_team_all',    TRUE, NULL),
  ('webhook.cartplus.order_changed', 'push',   'super_admin',         TRUE, NULL)
ON CONFLICT DO NOTHING;
