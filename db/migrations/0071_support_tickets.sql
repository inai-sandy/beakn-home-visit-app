-- =============================================================================
-- HVA-254 (HVA-232 Phase 1): customer support tickets
-- =============================================================================
--
-- Public form on /track/[token] lets the customer raise a complaint /
-- warranty claim / refund query / general "other" question. New
-- support_tickets table; assigned exec + captain get the in-app + push
-- notification when one is raised. Internal triage queue (page +
-- claim/resolve flow) is Phase 2 (HVA-256).
--
-- Anchored to a visit_request (FK CASCADE) so a deleted order also
-- removes its tickets. Customer name + phone snapshotted at submission
-- time for audit (in case the visit_requests row mutates later).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE support_ticket_category AS ENUM ('complaint', 'warranty', 'refund', 'other');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE support_ticket_status AS ENUM ('open', 'in_progress', 'resolved');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS support_tickets (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  request_id               UUID NOT NULL REFERENCES visit_requests(id) ON DELETE CASCADE,
  category                 support_ticket_category NOT NULL,
  subject                  VARCHAR(200) NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  description              TEXT         NOT NULL CHECK (char_length(description) BETWEEN 1 AND 2000),
  status                   support_ticket_status NOT NULL DEFAULT 'open',
  customer_name_snapshot   VARCHAR(255) NOT NULL,
  customer_phone_snapshot  VARCHAR(15)  NOT NULL,
  opened_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  claimed_at               TIMESTAMPTZ,
  claimed_by_user_id       UUID REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at              TIMESTAMPTZ,
  resolved_by_user_id      UUID REFERENCES users(id) ON DELETE RESTRICT,
  reopened_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "All tickets for this order, newest first" — /track page + Phase 2 queue
CREATE INDEX IF NOT EXISTS support_tickets_request_opened_idx
  ON support_tickets (request_id, opened_at DESC);

-- Phase 2 queue filters by status
CREATE INDEX IF NOT EXISTS support_tickets_status_opened_idx
  ON support_tickets (status, opened_at DESC);

-- "Tickets owned by user X" — Phase 2 self-claim lookup
CREATE INDEX IF NOT EXISTS support_tickets_claimed_by_idx
  ON support_tickets (claimed_by_user_id)
  WHERE claimed_by_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Notification rules
-- ---------------------------------------------------------------------------
--
-- in_app + push enabled out of the gate (no Meta dependency).
-- WhatsApp shipped enabled=false; Sandeep submits
-- `internal_support_ticket_received_v1` to Meta and flips on later.

INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  ('customer.support_ticket_created', 'in_app',   'exec_assigned',       TRUE,  NULL),
  ('customer.support_ticket_created', 'in_app',   'captain_owning_city', TRUE,  NULL),
  ('customer.support_ticket_created', 'push',     'exec_assigned',       TRUE,  NULL),
  ('customer.support_ticket_created', 'push',     'captain_owning_city', TRUE,  NULL),
  ('customer.support_ticket_created', 'whatsapp', 'exec_assigned',       FALSE, 'internal_support_ticket_received_v1'),
  ('customer.support_ticket_created', 'whatsapp', 'captain_owning_city', FALSE, 'internal_support_ticket_received_v1')
ON CONFLICT (event_type, channel, recipient_role) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Audit allow-list — every ticket mutation is recordable
-- ---------------------------------------------------------------------------
--
-- Dual-write per HVA-240 retrospective: migration appends + lib/config-schema.ts
-- defaults updated in the same PR.

UPDATE config
SET value = CASE
  WHEN value ? 'support_ticket_created' THEN value
  ELSE value || '["support_ticket_created"]'::jsonb
END
WHERE key = 'audit_enabled_events';

UPDATE config
SET value = CASE
  WHEN value ? 'support_ticket_claimed' THEN value
  ELSE value || '["support_ticket_claimed"]'::jsonb
END
WHERE key = 'audit_enabled_events';

UPDATE config
SET value = CASE
  WHEN value ? 'support_ticket_resolved' THEN value
  ELSE value || '["support_ticket_resolved"]'::jsonb
END
WHERE key = 'audit_enabled_events';

UPDATE config
SET value = CASE
  WHEN value ? 'support_ticket_reopened' THEN value
  ELSE value || '["support_ticket_reopened"]'::jsonb
END
WHERE key = 'audit_enabled_events';
