-- Libromi WhatsApp delivery telemetry — one row per template send.
--
-- The send-side wrapper at lib/notifications/channels/whatsapp.ts will
-- insert a row whenever the provider returns delivered (HTTP 201 +
-- messageId from Libromi). The webhook receiver at
-- /api/webhooks/libromi/[secret] then updates the lifecycle timestamp
-- columns (provider_sent_at / delivered_at / read_at / failed_at) as
-- each status event arrives.
--
-- See db/schema/notifications.ts for the column-level docs.
--
-- This is ALSO the spoof defence: webhook events whose `messageId` is
-- not present in this table get logged + dropped. No DB write.

CREATE TABLE whatsapp_dispatches (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v7(),
  external_id          VARCHAR(64)  NOT NULL,
  wamid                VARCHAR(128),
  recipient_phone      VARCHAR(20)  NOT NULL,
  template_name        VARCHAR(100) NOT NULL,
  event_type           VARCHAR(100) NOT NULL,
  recipient_role       VARCHAR(50)  NOT NULL,
  request_id           UUID REFERENCES visit_requests(id) ON DELETE SET NULL,
  recipient_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  sent_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  provider_sent_at     TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  read_at              TIMESTAMPTZ,
  failed_at            TIMESTAMPTZ,
  failure_code         INTEGER,
  failure_reason       TEXT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX whatsapp_dispatches_external_id_unique
  ON whatsapp_dispatches (external_id);

CREATE INDEX whatsapp_dispatches_wamid_idx
  ON whatsapp_dispatches (wamid);

CREATE INDEX whatsapp_dispatches_recipient_phone_idx
  ON whatsapp_dispatches (recipient_phone);

CREATE INDEX whatsapp_dispatches_request_id_idx
  ON whatsapp_dispatches (request_id);

CREATE INDEX whatsapp_dispatches_recipient_user_idx
  ON whatsapp_dispatches (recipient_user_id);

CREATE INDEX whatsapp_dispatches_event_type_idx
  ON whatsapp_dispatches (event_type);

CREATE INDEX whatsapp_dispatches_sent_at_idx
  ON whatsapp_dispatches (sent_at);
