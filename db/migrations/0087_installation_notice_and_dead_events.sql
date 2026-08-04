-- =============================================================================
-- 0087 — tell the customer, and stop dispatching into the void
--        (HVA-319 + HVA-316)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- HVA-319: the customer is told the installation date
-- ---------------------------------------------------------------------------
--
-- `request.installation_scheduled` has only ever had in_app + push rules to
-- exec_assigned / captain_owning_city / super_admin. The customer — the one
-- person who needs to be home for it — was never told.
--
-- Until HVA-317 there was nothing to tell them: the transition stored no date.
-- Now it does, and lib/visit-schedule/actions.ts puts installationScheduledAt
-- into the dispatch context, so the template renders a real time rather than
-- visitMoment()'s "the scheduled time" fallback.
--
-- Ships DISABLED. The `installation_scheduled` Meta template is not approved
-- yet, and an enabled rule pointing at an unapproved template produces a
-- permanent INVALID_ARGUMENT from the provider on every send — recorded as a
-- failed delivery that nothing alerts on. That is the HVA-306 failure mode.
-- The composer is registered and unit-tested, so switching it on at
-- /admin/settings/notifications/rules is the only remaining step.

INSERT INTO notification_rules (event_type, channel, recipient_role, enabled, template_key)
VALUES
  ('request.installation_scheduled', 'whatsapp', 'customer', FALSE, 'installation_scheduled')
ON CONFLICT (event_type, channel, recipient_role) DO UPDATE
  SET template_key = EXCLUDED.template_key;

-- ---------------------------------------------------------------------------
-- HVA-316: two transition events that matched no rule
-- ---------------------------------------------------------------------------
--
-- The guard test added in HVA-311 found these on its first run. Both are
-- DUPLICATE names for an event the route handler already dispatches under a
-- different name:
--
--   status_rolled_back           → rollback/route.ts:344 fires request.rolled_back
--   request.rejected_by_captain  → reject/route.ts:218   fires request.rejected
--
-- Both of those have live rules, so no notification is missing today. What
-- exists is a second dispatch per action that matches zero rules: the engine
-- logs rulesMatched=0, delivers nothing, and — unlike a missing composer —
-- leaves no failed-delivery breadcrumb. Quieter than a bug.
--
-- Fixed by clearing emits_event rather than by pointing it at the working
-- name. The route dispatches carry context the generic path cannot build:
-- reject/route.ts supplies supportPhone (the `we_had_to_cancel` template's
-- {{2}}), plus reason and captainName. Repointing emits_event would fire the
-- same events with a thinner context and render the customer's message
-- without the support number.
--
-- The alternative — moving that context into lib/status-transition.ts so the
-- table drives it — is the better long-term shape, but it is a behaviour
-- change to live customer messaging and belongs in its own reviewed ticket,
-- not smuggled in beside a notification fix.

WITH s AS (SELECT code, id FROM status_stages)
UPDATE status_transitions st
SET emits_event = NULL,
    updated_at  = NOW()
FROM s fs, s ts
WHERE st.from_stage_id = fs.id
  AND st.to_stage_id   = ts.id
  AND fs.code = 'PENDING_CAPTAIN_APPROVAL'
  AND ts.code = 'INSTALLATION_SCHEDULED'
  AND st.emits_event = 'request.rejected_by_captain';

UPDATE status_transitions
SET emits_event = NULL,
    updated_at  = NOW()
WHERE emits_event = 'status_rolled_back';
