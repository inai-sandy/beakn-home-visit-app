import { log } from '@/lib/logger';

import { libromiWhatsAppProvider } from './libromi-provider';
import { stubWhatsAppProvider } from './stub-provider';
import type { WhatsAppProvider } from './types';

// HVA-45: provider selection. `WHATSAPP_PROVIDER` env var picks the
// implementation. Default is 'stub' so dev + tests + brand-new prod
// installs don't try to reach Libromi until credentials are configured.

const factoryLog = log.child({ component: 'whatsapp.factory' });

let cached: WhatsAppProvider | null = null;

export function getWhatsAppProvider(): WhatsAppProvider {
  if (cached) return cached;
  const choice = (process.env.WHATSAPP_PROVIDER ?? 'stub').toLowerCase();
  if (choice === 'libromi') {
    factoryLog.info({ provider: 'libromi' }, 'whatsapp_provider_selected');
    cached = libromiWhatsAppProvider;
    return cached;
  }
  if (choice !== 'stub') {
    factoryLog.warn(
      { unknown: choice },
      'whatsapp_provider_unknown_falling_back_to_stub',
    );
  }
  factoryLog.info({ provider: 'stub' }, 'whatsapp_provider_selected');
  cached = stubWhatsAppProvider;
  return cached;
}

/** Test/recon override. Set or unset between calls. */
export function _resetWhatsAppProviderForTests(): void {
  cached = null;
}

export type { TemplateComponent, TemplateMessage, TemplateParameter, WhatsAppProvider, WhatsAppSendInput, WhatsAppSendResult } from './types';
