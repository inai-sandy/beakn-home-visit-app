-- =============================================================================
-- HVA-232 Phase 3 (migration 0082): two-way support ticket messaging
-- =============================================================================
--
-- Turns the one-way ticket (customer raises → staff claim/resolve, no
-- reply, no customer notification) into a proper two-way thread:
--   * support_ticket_messages — append-only message log. author_kind
--     'staff' (author_user_id set) or 'customer' (author_user_id NULL).
--   * customer.support_ticket_resolved — customer-facing WhatsApp nudge
--     fired when staff resolve a ticket (opt-in gated; else the customer
--     just sees the closing note on /track).
--   * customer.support_ticket_reply — staff-facing in-app + push when the
--     customer posts a reply. Mirrors customer.support_ticket_created.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE support_ticket_author_kind AS ENUM ('staff', 'customer');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  ticket_id        UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_kind      support_ticket_author_kind NOT NULL,
  -- NULL for customer authors (no user row); RESTRICT keeps a staff
  -- author's reply history intact if the user is later removed.
  author_user_id   UUID REFERENCES users(id) ON DELETE RESTRICT,
  body             TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Staff messages carry an author; customer messages must not.
  CONSTRAINT support_ticket_messages_author_kind_consistency CHECK (
    (author_kind = 'staff' AND author_user_id IS NOT NULL)
    OR (author_kind = 'customer' AND author_user_id IS NULL)
  )
);

-- "All messages for this ticket, oldest first" — thread render (staff + customer)
CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_created_idx
  ON support_ticket_messages (ticket_id, created_at);

-- HVA-232 Phase 3: open-workload count for the exec/captain/admin Tickets
-- nav badge (status IN ('open','in_progress')).
CREATE INDEX IF NOT EXISTS support_tickets_status_idx
  ON support_tickets (status);

-- ---------------------------------------------------------------------------
-- Notification rules
-- ---------------------------------------------------------------------------
--
-- customer.support_ticket_resolved — customer-facing. WhatsApp only (the
-- customer has no in-app login); opt-in gated in the engine. Ships enabled
-- like the other 8 customer WhatsApp templates (HVA-46/47); the Meta
-- template `support_ticket_resolved` must be approved before sends land —
-- until then the engine records a failed delivery and the customer still
-- sees the closing note on /track. No in_app rule: 'customer' + 'in_app' is
-- an invalid combo the engine skips by design.
--
-- customer.support_ticket_reply — staff-facing. Mirrors
-- customer.support_ticket_created (exec_assigned + captain_owning_city on
-- in_app + push; WhatsApp seeded disabled pending a Meta template).

INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  -- Ships DISABLED: there is no WHATSAPP_COMPOSER for 'support_ticket_resolved'
  -- yet, and the Meta template isn't approved — enabling it now would hard-fail
  -- every resolve with no_whatsapp_composer_for_support_ticket_resolved (the
  -- same failure class migration 0080 defused). Enable once the composer is
  -- authored + the template approved. The customer still sees the resolution
  -- (and any closing note) on /track regardless.
  ('customer.support_ticket_resolved', 'whatsapp', 'customer', FALSE, 'support_ticket_resolved'),

  ('customer.support_ticket_reply', 'in_app',   'exec_assigned',       TRUE,  NULL),
  ('customer.support_ticket_reply', 'in_app',   'captain_owning_city', TRUE,  NULL),
  ('customer.support_ticket_reply', 'push',     'exec_assigned',       TRUE,  NULL),
  ('customer.support_ticket_reply', 'push',     'captain_owning_city', TRUE,  NULL),
  ('customer.support_ticket_reply', 'whatsapp', 'exec_assigned',       FALSE, 'internal_support_ticket_reply_v1'),
  ('customer.support_ticket_reply', 'whatsapp', 'captain_owning_city', FALSE, 'internal_support_ticket_reply_v1')
ON CONFLICT (event_type, channel, recipient_role) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Audit allow-list — the new message event
-- ---------------------------------------------------------------------------
--
-- Dual-write per HVA-240 retrospective: migration appends + lib/config-schema.ts
-- defaults updated in the same PR.

UPDATE config
SET value = CASE
  WHEN value ? 'support_ticket_message_added' THEN value
  ELSE value || '["support_ticket_message_added"]'::jsonb
END
WHERE key = 'audit_enabled_events';
