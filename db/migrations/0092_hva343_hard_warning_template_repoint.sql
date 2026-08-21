-- =============================================================================
-- HVA-343: the exec hard-warning WhatsApp pointed at a template that does not
-- exist, while the real one sat approved and unused.
-- =============================================================================
--
-- `exec.hard_warning_issued` / whatsapp / exec carried
-- template_key = 'internal_hard_warning_v1'. No such template has ever existed
-- at the provider. Meanwhile `hard_warning` has been APPROVED at Meta since the
-- HVA-228 batch and was never wired to anything, so the rule was switched off
-- and the exec was told about a formal performance notice by in-app and push
-- only.
--
-- Repointing the rule at the approved name and enabling it is the whole fix —
-- no Meta submission, no waiting. The composer landed in the same change and
-- renders the 8 parameters the approved body expects, using the same helpers
-- that build the in-app message_snapshot so the two cannot disagree.
--
-- The other 12 dead WhatsApp rules stay disabled: their templates genuinely
-- have not been submitted yet. Enabling one of those would return a permanent
-- INVALID_ARGUMENT per send, recorded as a failed delivery nothing alerts on.
-- They get flipped, per template, as Meta approves them.

UPDATE notification_rules
SET template_key = 'hard_warning',
    enabled = true,
    updated_at = now()
WHERE event_type = 'exec.hard_warning_issued'
  AND channel = 'whatsapp'
  AND template_key = 'internal_hard_warning_v1';
