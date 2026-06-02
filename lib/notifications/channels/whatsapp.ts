import { db } from '@/db/client';
import { whatsappDispatches } from '@/db/schema';
import { log } from '@/lib/logger';
import { getWhatsAppProvider } from '@/lib/whatsapp';
import type { TemplateMessage } from '@/lib/whatsapp';

import { WHATSAPP_COMPOSERS } from '../compose/whatsapp-events';

import type { AdapterArgs, AdapterResult } from './in-app';

// =============================================================================
// HVA-45 / HVA-49: WhatsApp channel adapter — delegates to the configured provider
// =============================================================================
//
// The notification engine hands us a target (phone number) + event type +
// context + template key. We look up a composer registered for the
// template (NOT the event_type — one event can have multiple recipient
// roles with different templates), produce a Meta-shaped template
// payload, hand it to the provider, and translate the provider's result
// into the engine's AdapterResult shape.
//
// If no composer exists for the template, we fail-soft with
// `no_composer_*` (matches the in-app adapter's contract). The engine
// then records this as `status: 'failed'` in the deliveries array —
// distinguishable from a real send failure by the error code.
//
// Never throws.
// =============================================================================

const channelLog = log.child({ component: 'notifications.whatsapp' });

export async function sendViaWhatsApp(args: AdapterArgs): Promise<AdapterResult> {
  // HVA-49: composer keyed by templateKey, not eventType. Rules without
  // a templateKey can't dispatch — there's no body to send.
  if (!args.templateKey) {
    channelLog.warn(
      { event: args.eventType, target: args.target },
      'whatsapp_rule_missing_template_key',
    );
    return {
      status: 'failed',
      error: `no_template_key_for_${args.eventType}`,
    };
  }
  const composer = WHATSAPP_COMPOSERS[args.templateKey];
  if (!composer) {
    channelLog.warn(
      { event: args.eventType, target: args.target, templateKey: args.templateKey },
      'whatsapp_no_composer',
    );
    return {
      status: 'failed',
      error: `no_whatsapp_composer_for_${args.templateKey}`,
    };
  }

  let template: TemplateMessage;
  try {
    template = composer({
      target: args.target,
      context: args.context,
      templateKey: args.templateKey,
      targetUserName: args.targetUserName ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    channelLog.error(
      { event: args.eventType, target: args.target, templateKey: args.templateKey, err: message },
      'whatsapp_composer_threw',
    );
    return { status: 'failed', error: `composer_threw: ${message}` };
  }

  const provider = getWhatsAppProvider();
  const result = await provider.send({ to: args.target, template });

  if (result.status === 'delivered') {
    channelLog.info(
      {
        event: args.eventType,
        target: args.target,
        provider: provider.name,
        externalId: result.externalId,
        templateName: template.name,
      },
      'whatsapp_send_ok',
    );

    // Libromi-webhook telemetry: persist a row keyed on the provider's
    // externalId so the webhook receiver can look up the dispatch and
    // update lifecycle timestamps as `sent` / `delivered` / `read` /
    // `failed` events arrive. The insert is best-effort — if the DB is
    // momentarily unavailable we still consider the send delivered
    // (the customer got the message; only the telemetry row is missing).
    // The stub provider returns externalId='stub_whatsapp' — those
    // dispatches never receive real webhooks but we still log them for
    // dev/test parity.
    const requestIdValue = args.context.requestId;
    const recipientUserId = args.context.execUserId
      ?? args.context.captainUserId
      ?? args.context.assistExecUserId
      ?? args.context.assistCaptainUserId
      ?? null;
    try {
      // onConflictDoNothing on external_id — stub provider returns a
      // constant externalId 'stub_whatsapp' so back-to-back stub sends
      // would otherwise violate the UNIQUE. Real Libromi sends always
      // get a fresh messageId so the conflict path never fires in prod.
      await db
        .insert(whatsappDispatches)
        .values({
          externalId: result.externalId,
          recipientPhone: args.target,
          templateName: template.name,
          eventType: args.eventType,
          recipientRole:
            typeof args.context.recipientRole === 'string'
              ? args.context.recipientRole
              : 'unknown',
          requestId:
            typeof requestIdValue === 'string' && requestIdValue.length > 0
              ? requestIdValue
              : null,
          recipientUserId:
            typeof recipientUserId === 'string' && recipientUserId.length > 0
              ? recipientUserId
              : null,
        })
        .onConflictDoNothing({ target: whatsappDispatches.externalId });
    } catch (err) {
      // Don't fail the send on telemetry errors — log + continue.
      channelLog.warn(
        {
          event: args.eventType,
          externalId: result.externalId,
          err: err instanceof Error ? err.message : String(err),
        },
        'whatsapp_dispatch_insert_failed',
      );
    }

    return { status: 'delivered', externalId: result.externalId };
  }

  channelLog.error(
    {
      event: args.eventType,
      target: args.target,
      provider: provider.name,
      templateName: template.name,
      error: result.error,
    },
    'whatsapp_send_failed',
  );
  return { status: 'failed', error: result.error };
}
