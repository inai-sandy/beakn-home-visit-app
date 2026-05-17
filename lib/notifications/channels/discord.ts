import { log } from '@/lib/logger';

import type { AdapterArgs, AdapterResult } from './in-app';

// =============================================================================
// HVA-48 + HVA-43: Discord channel adapter — STUB
// =============================================================================
//
// HVA-43 wires the generic Discord-channel routing (HVA-41 already
// handles the customer-submission-only case via per-city webhooks on
// `cities.discord_webhook_url`). Until then, the adapter logs a single
// line `discord_stub_invoked` so smoke tests can verify the engine is
// fanning out correctly. The stub returns `delivered` so callers can
// complete their dispatch result.
//
// Never throws.
// =============================================================================

const channelLog = log.child({ component: 'notifications.discord' });

export async function sendViaDiscord(args: AdapterArgs): Promise<AdapterResult> {
  channelLog.info(
    {
      target: args.target,
      eventType: args.eventType,
      templateKey: args.templateKey,
    },
    'discord_stub_invoked',
  );
  return { status: 'delivered', externalId: 'stub_discord' };
}
