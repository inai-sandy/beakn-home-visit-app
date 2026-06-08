-- =============================================================================
-- HVA-248 (HVA-230 Phase 1.A): CartPlus webhook foundation
-- =============================================================================
--
-- Schema columns + admin-managed mapping tables that the webhook handler
-- (HVA-249/250 in follow-up tickets) reads from.
--
-- HVA-234 (migration 0063) already shipped the quotation_source enum,
-- quotations.source / portal_quotation_id / raw_payload / last_webhook_at
-- — we DO NOT re-add those here. The existing portal_quotation_id varchar(64)
-- holds CartPlus's data.order.id stringified.
--
-- Locks per HVA-230 + memory hva-230-cartplus-webhook.md:
--   * Provider auth: HMAC-SHA256 (secret stored plaintext, super_admin-only
--     access; rotated by issuing a new secret + revoking the old)
--   * Idempotency: envelope `id` (e.g. evt_…) UNIQUE per provider
--   * Exec mapping: users.portal_exec_id (bigint, admin sets per user)
--   * City mapping: cities.cartplus_store_id (bigint, admin sets per city)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Mapping columns on existing tables
-- ---------------------------------------------------------------------------

ALTER TABLE cities
  ADD COLUMN IF NOT EXISTS cartplus_store_id BIGINT;

-- Partial unique — unmapped cities (NULL) can co-exist; mapped cities must
-- have a distinct store_id.
CREATE UNIQUE INDEX IF NOT EXISTS cities_cartplus_store_id_unique_idx
  ON cities (cartplus_store_id)
  WHERE cartplus_store_id IS NOT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS portal_exec_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS users_portal_exec_id_unique_idx
  ON users (portal_exec_id)
  WHERE portal_exec_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Audit trail on quotations: which CartPlus store.id this row came from
-- ---------------------------------------------------------------------------
--
-- portal_quotation_id (varchar) already records the order ID; this records
-- the store.id at creation time so the trail survives even if cities↔store
-- mapping changes later. Only populated when source='portal'.

ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS store_id BIGINT;

-- ---------------------------------------------------------------------------
-- 3. quotation_line_items — track CartPlus item identifiers for upsert
-- ---------------------------------------------------------------------------

ALTER TABLE quotation_line_items
  ADD COLUMN IF NOT EXISTS portal_product_id   BIGINT,
  ADD COLUMN IF NOT EXISTS portal_line_item_id BIGINT;

-- Partial UNIQUE — stable across CartPlus revisions; used by the handler
-- to upsert items on order.status_changed.
CREATE UNIQUE INDEX IF NOT EXISTS quotation_line_items_portal_line_item_unique_idx
  ON quotation_line_items (portal_line_item_id)
  WHERE portal_line_item_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. webhook_events — idempotency log + dead-letter store
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS webhook_events (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  provider           VARCHAR(50)  NOT NULL,
  provider_event_id  VARCHAR(255) NOT NULL,
  event_type         VARCHAR(100) NOT NULL,
  delivery_id        VARCHAR(255),
  payload            JSONB        NOT NULL,
  received_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  processed_at       TIMESTAMPTZ,
  result             VARCHAR(20),
  error_message      TEXT,
  CONSTRAINT webhook_events_provider_event_id_unique UNIQUE (provider, provider_event_id),
  CONSTRAINT webhook_events_result_check CHECK (result IN ('ok','noop','error') OR result IS NULL)
);

CREATE INDEX IF NOT EXISTS webhook_events_received_at_idx
  ON webhook_events (received_at DESC);

CREATE INDEX IF NOT EXISTS webhook_events_event_type_idx
  ON webhook_events (event_type);

-- Fast "dead letter view" lookup (only errored events).
CREATE INDEX IF NOT EXISTS webhook_events_errors_idx
  ON webhook_events (received_at DESC)
  WHERE result = 'error';

-- ---------------------------------------------------------------------------
-- 5. webhook_secrets — admin-rotatable signing secrets
-- ---------------------------------------------------------------------------
--
-- secret is stored PLAINTEXT (needed to compute HMAC-SHA256 against
-- incoming request bodies — we cannot verify the signature otherwise).
-- Access is gated to super_admin via the admin UI + server actions.
-- Adding column-level encryption later means migrating this column; the
-- column name `secret` is generic enough to live with both schemes.
--
-- secret_preview = first 4 + "…" + last 4 of the plaintext (e.g.
-- "ab12…cd34"). Shown in lists so admin can correlate without revealing
-- the full secret.

CREATE TABLE IF NOT EXISTS webhook_secrets (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  provider            VARCHAR(50) NOT NULL,
  secret              TEXT NOT NULL,
  secret_preview      VARCHAR(20) NOT NULL,
  created_by_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at          TIMESTAMPTZ,
  last_used_at        TIMESTAMPTZ
);

-- "Active secret for provider X" lookup — partial because revoked secrets
-- stay in the table for audit but aren't candidates.
CREATE INDEX IF NOT EXISTS webhook_secrets_active_idx
  ON webhook_secrets (provider)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS webhook_secrets_created_at_idx
  ON webhook_secrets (provider, created_at DESC);

-- ---------------------------------------------------------------------------
-- 6. Audit event allow-list — let webhook-related events be auditable
-- ---------------------------------------------------------------------------
--
-- Dual-write rule (HVA-240 retrospective): the migration appends to the
-- live config row AND lib/config-schema.ts defaults get the same values in
-- the same PR so testcontainer + new installs start aligned with prod.

UPDATE config
SET value = CASE
  WHEN value ? 'webhook_secret_generated' THEN value
  ELSE value || '["webhook_secret_generated"]'::jsonb
END
WHERE key = 'audit_enabled_events';

UPDATE config
SET value = CASE
  WHEN value ? 'webhook_secret_revoked' THEN value
  ELSE value || '["webhook_secret_revoked"]'::jsonb
END
WHERE key = 'audit_enabled_events';

UPDATE config
SET value = CASE
  WHEN value ? 'cartplus_city_mapping_updated' THEN value
  ELSE value || '["cartplus_city_mapping_updated"]'::jsonb
END
WHERE key = 'audit_enabled_events';

UPDATE config
SET value = CASE
  WHEN value ? 'cartplus_exec_mapping_updated' THEN value
  ELSE value || '["cartplus_exec_mapping_updated"]'::jsonb
END
WHERE key = 'audit_enabled_events';
