import { log } from '@/lib/logger';
import { getWhatsAppProvider } from '@/lib/whatsapp';
import type { TemplateMessage } from '@/lib/whatsapp';

import { WHATSAPP_COMPOSERS } from '../compose/whatsapp-events';

import type { AdapterArgs, AdapterResult } from './in-app';

// =============================================================================
// HVA-45: WhatsApp channel adapter — delegates to the configured provider
// =============================================================================
//
// The notification engine hands us a target (phone number) + event type +
// context + template key. We look up a composer registered for the event,
// produce a Meta-shaped template payload, hand it to the provider, and
// translate the provider's result into the engine's AdapterResult shape.
//
// If no composer exists for the event, we fail-soft with `no_composer_*`
// (matches the in-app adapter's contract). The engine then records this
// as `status: 'failed'` in the deliveries array — distinguishable from a
// real send failure by the error code.
//
// Never throws.
// =============================================================================

const channelLog = log.child({ component: 'notifications.whatsapp' });

export async function sendViaWhatsApp(args: AdapterArgs): Promise<AdapterResult> {
  const composer = WHATSAPP_COMPOSERS[args.eventType];
  if (!composer) {
    channelLog.warn(
      { event: args.eventType, target: args.target },
      'whatsapp_no_composer',
    );
    return {
      status: 'failed',
      error: `no_whatsapp_composer_for_${args.eventType}`,
    };
  }

  let template: TemplateMessage;
  try {
    template = composer({
      target: args.target,
      context: args.context,
      templateKey: args.templateKey,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    channelLog.error(
      { event: args.eventType, target: args.target, err: message },
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
