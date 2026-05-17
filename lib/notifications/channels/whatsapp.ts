import { log } from '@/lib/logger';

import type { AdapterArgs, AdapterResult } from './in-app';

// =============================================================================
// HVA-48 + HVA-49: WhatsApp channel adapter — STUB
// =============================================================================
//
// HVA-49 wires the BSP integration when credentials land. Until then,
// the adapter logs a single line `whatsapp_stub_invoked` carrying the
// target + eventType + context so smoke tests can verify the engine is
// fanning out correctly. The stub returns `delivered` (the no-op
// succeeded) so callers can complete their dispatch result.
//
// Never throws.
// =============================================================================

const channelLog = log.child({ component: 'notifications.whatsapp' });

export async function sendViaWhatsApp(args: AdapterArgs): Promise<AdapterResult> {
  channelLog.info(
    {
      target: args.target,
      eventType: args.eventType,
      templateKey: args.templateKey,
    },
    'whatsapp_stub_invoked',
  );
  return { status: 'delivered', externalId: 'stub_whatsapp' };
}
