-- HVA-199: Assist section
--
-- Exec submits a structured material-request (today; future "assist types"
-- append as enum values). Captain/admin processes through a 4-stage
-- state machine: submitted → approved → processing → dispatched, with
-- rejected reachable from any pre-terminal stage.
--
-- Three tables + three enums. Schema reserves the `type` axis from day
-- one so future assist categories slot in without restructuring.

CREATE TYPE assist_type AS ENUM ('material_request');

CREATE TYPE assist_status AS ENUM (
  'submitted',
  'approved',
  'processing',
  'dispatched',
  'rejected'
);

CREATE TYPE assist_priority AS ENUM ('high', 'medium', 'low');

CREATE TABLE IF NOT EXISTS assist_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  exec_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type assist_type NOT NULL DEFAULT 'material_request',
  status assist_status NOT NULL DEFAULT 'submitted',
  order_number text,
  dispatch_by_date date,
  priority assist_priority NOT NULL DEFAULT 'medium',
  message text,
  linked_visit_request_id uuid REFERENCES visit_requests(id) ON DELETE SET NULL,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assist_requests_exec_idx
  ON assist_requests (exec_user_id);
CREATE INDEX IF NOT EXISTS assist_requests_status_idx
  ON assist_requests (status);
CREATE INDEX IF NOT EXISTS assist_requests_type_idx
  ON assist_requests (type);
CREATE INDEX IF NOT EXISTS assist_requests_created_at_idx
  ON assist_requests (created_at);

CREATE TABLE IF NOT EXISTS assist_request_items (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  assist_request_id uuid NOT NULL REFERENCES assist_requests(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assist_request_items_request_idx
  ON assist_request_items (assist_request_id);

-- Status transition audit trail. `from_status` is null on the initial
-- submit row so the timeline starts cleanly.
CREATE TABLE IF NOT EXISTS assist_request_status_history (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  assist_request_id uuid NOT NULL REFERENCES assist_requests(id) ON DELETE CASCADE,
  from_status assist_status,
  to_status assist_status NOT NULL,
  changed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text,
  changed_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assist_request_status_history_request_idx
  ON assist_request_status_history (assist_request_id, changed_at);
