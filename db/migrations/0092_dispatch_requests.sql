-- =============================================================================
-- HVA-342: the exec's material request becomes part of the order
-- =============================================================================
--
-- The Assist section (HVA-199, migrations 0049/0050) let an exec type a
-- product name into a text box and a quantity beside it. Nothing tied that
-- text to the order it was about:
--
--   * assist_request_items.product_name was free text, not a line item.
--   * assist_requests.order_number was free text too.
--   * linked_visit_request_id was optional and used only for display.
--   * marking an assist 'dispatched' wrote NO dispatches row. It shipped
--     nothing and reduced no pending quantity — the status was a label on a
--     form, and the form and the order could never agree.
--
-- Used once in production (one test row, 2026-05-30) and abandoned.
--
-- The replacement points at real quotation_line_items rows. That is the whole
-- fix: the numbers agree by construction instead of by somebody typing
-- carefully.
--
-- Shape, and why it is three tables rather than two:
--
--   dispatch_requests        the header — who asked, how urgently, by when.
--   dispatch_request_orders  ONE ROW PER ORDER inside the request.
--   dispatch_request_items   the line items asked for, within an order group.
--
-- The middle table is the part worth explaining. An exec may tick products
-- across several of their orders in one submission, but a `dispatches` row is
-- one physical shipment with one courier and one tracking number — three
-- customers cannot share one. So a request spanning N orders must fan out
-- into N dispatches, and support has to be able to approve one order group
-- while holding another (stock for this customer, not that one). Hanging the
-- decision off a per-order group is what makes partial approval expressible
-- at all; a status on the header would force all-or-nothing and support would
-- go straight back to working around the screen.
--
-- What this migration deliberately does NOT add: any copy of the product
-- name, the quantity ordered, or the price. Those live on
-- quotation_line_items and are read through the FK. Copying them is how the
-- old table drifted from the order in the first place.
--
-- On retiring Assist: this migration takes the section OUT OF SERVICE but
-- does not drop it. The rules are disabled so no assist.* notification can
-- fire, and the application code is removed in the same PR, so nothing can
-- read or write these tables. The tables themselves are left dormant on
-- purpose — irreversible DDL does not belong in the same change that ships a
-- feature, and a dead table costs nothing. A follow-up drops them once this
-- has run in production for a while.
-- =============================================================================

-- --------------------------------------------------------------------------
-- 1. Enums
-- --------------------------------------------------------------------------

-- Header lifecycle. Rolled up from the order groups by the application, not
-- by a trigger: 'open' while any group is still undecided, 'closed' once
-- every group is approved or rejected, 'cancelled' when the exec withdraws.
DO $$ BEGIN
  CREATE TYPE dispatch_request_status AS ENUM ('open', 'closed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Per-order-group decision.
--   pending  — support has not looked at it yet
--   approved — a real dispatches row exists (see dispatch_id)
--   held     — support looked and cannot ship yet (no stock, waiting)
--   rejected — will not be shipped; the application requires a reason
--
-- 'held' is a distinct state from 'pending' on purpose: "nobody has looked at
-- it" and "we looked and cannot do it" are indistinguishable to an exec
-- otherwise, and an exec chasing an order needs to know which one they are
-- in before they ring the customer back.
DO $$ BEGIN
  CREATE TYPE dispatch_request_order_status AS ENUM (
    'pending', 'approved', 'held', 'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dispatch_request_priority AS ENUM ('high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- --------------------------------------------------------------------------
-- 2. Tables
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS dispatch_requests (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  exec_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status            dispatch_request_status NOT NULL DEFAULT 'open',
  priority          dispatch_request_priority NOT NULL DEFAULT 'medium',
  -- Support sequences the queue by these two. Both optional: an exec asking
  -- for stock they need "whenever" should not have to invent a date.
  required_by_date  DATE,
  message           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS dispatch_requests_exec_idx
  ON dispatch_requests (exec_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dispatch_requests_status_idx
  ON dispatch_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS dispatch_request_orders (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  dispatch_request_id UUID NOT NULL
                        REFERENCES dispatch_requests(id) ON DELETE CASCADE,
  visit_request_id    UUID NOT NULL
                        REFERENCES visit_requests(id) ON DELETE CASCADE,
  status              dispatch_request_order_status NOT NULL DEFAULT 'pending',
  -- Set when status becomes 'approved'. RESTRICT rather than CASCADE: the
  -- dispatch is the record of stock that physically left, so it must not be
  -- removable out from under the request that caused it.
  dispatch_id         UUID REFERENCES dispatches(id) ON DELETE RESTRICT,
  decided_by_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at          TIMESTAMPTZ,
  decision_reason     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One group per order per request. Ticking two products from the same
  -- order puts both items in the SAME group — that is the point of the table.
  CONSTRAINT dispatch_request_orders_unique
    UNIQUE (dispatch_request_id, visit_request_id),
  -- An approved group with no dispatch behind it would be the old Assist bug
  -- all over again: a status claiming something shipped with nothing there.
  CONSTRAINT dispatch_request_orders_approved_has_dispatch
    CHECK (status <> 'approved' OR dispatch_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS dispatch_request_orders_request_idx
  ON dispatch_request_orders (dispatch_request_id);
CREATE INDEX IF NOT EXISTS dispatch_request_orders_visit_request_idx
  ON dispatch_request_orders (visit_request_id);
CREATE INDEX IF NOT EXISTS dispatch_request_orders_status_idx
  ON dispatch_request_orders (status);

CREATE TABLE IF NOT EXISTS dispatch_request_items (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  dispatch_request_order_id UUID NOT NULL
                              REFERENCES dispatch_request_orders(id)
                              ON DELETE CASCADE,
  -- The whole point of this ticket. RESTRICT so a line item cannot be hard
  -- deleted while a request still points at it; a CartPlus removal is a soft
  -- removed_at and is handled by cancelled_at below, never by deletion.
  quotation_line_item_id    UUID NOT NULL
                              REFERENCES quotation_line_items(id)
                              ON DELETE RESTRICT,
  quantity                  INTEGER NOT NULL,
  -- Set when the customer deleted this product in CartPlus after the exec
  -- asked for it. The row is kept rather than removed so the exec can see
  -- what became of something they were waiting on.
  cancelled_at              TIMESTAMPTZ,
  cancelled_reason          TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dispatch_request_items_quantity_chk CHECK (quantity > 0),
  CONSTRAINT dispatch_request_items_unique
    UNIQUE (dispatch_request_order_id, quotation_line_item_id)
);

CREATE INDEX IF NOT EXISTS dispatch_request_items_order_idx
  ON dispatch_request_items (dispatch_request_order_id);
-- Drives the CartPlus-removal sweep: given a line item that was just
-- removed, find the still-open request lines pointing at it.
CREATE INDEX IF NOT EXISTS dispatch_request_items_line_item_idx
  ON dispatch_request_items (quotation_line_item_id)
  WHERE cancelled_at IS NULL;

-- --------------------------------------------------------------------------
-- 3. Notification rules
-- --------------------------------------------------------------------------
--
-- The captain is no longer in this path (the exec asks, support ships), so
-- `assist_team_captain` has no successor — the new "somebody asked for stock"
-- event goes to the people who can actually act on it.
-- --------------------------------------------------------------------------

INSERT INTO notification_rules (event_type, channel, recipient_role, enabled)
VALUES
  -- New request: everyone who can ship it, plus super_admin oversight.
  ('dispatch_request.created',   'in_app', 'support_team_all',           TRUE),
  ('dispatch_request.created',   'push',   'support_team_all',           TRUE),
  ('dispatch_request.created',   'in_app', 'super_admin',                TRUE),
  -- Decisions go back to the exec who asked, so they stop chasing.
  ('dispatch_request.approved',  'in_app', 'dispatch_request_submitter', TRUE),
  ('dispatch_request.approved',  'push',   'dispatch_request_submitter', TRUE),
  ('dispatch_request.held',      'in_app', 'dispatch_request_submitter', TRUE),
  ('dispatch_request.held',      'push',   'dispatch_request_submitter', TRUE),
  ('dispatch_request.rejected',  'in_app', 'dispatch_request_submitter', TRUE),
  ('dispatch_request.rejected',  'push',   'dispatch_request_submitter', TRUE),
  -- The customer deleted something the exec was waiting on.
  ('dispatch_request.item_cancelled', 'in_app', 'dispatch_request_submitter', TRUE),
  ('dispatch_request.item_cancelled', 'push',   'dispatch_request_submitter', TRUE)
ON CONFLICT (event_type, channel, recipient_role) DO NOTHING;

-- --------------------------------------------------------------------------
-- 4. Take Assist out of service
-- --------------------------------------------------------------------------
--
-- The assist.* composers are gone with the section, so these rows are config
-- pointing at code that no longer exists. Disabling them is not enough:
-- tests/notifications/composer-coverage.test.ts asserts that every in_app and
-- push rule has a composer behind it, and it is right to — a rule with no
-- composer is a notification that silently fails at send time. So the rows go.
--
-- Config rows only. The assist_* TABLES are left dormant and dropped by a
-- follow-up: irreversible DDL does not belong in the same change that ships a
-- feature, and a dead table costs nothing meanwhile.
-- --------------------------------------------------------------------------

DELETE FROM notification_preferences WHERE event_type LIKE 'assist.%';
DELETE FROM notification_rules WHERE event_type LIKE 'assist.%';
