import { log } from '@/lib/logger';

import type { WhatsAppProvider, WhatsAppSendInput, WhatsAppSendResult } from './types';

// HVA-45: stub provider for dev + tests. Logs the would-be send and
// returns delivered. Used when WHATSAPP_PROVIDER is unset or 'stub'.

const stubLog = log.child({ component: 'whatsapp.stub' });

export const stubWhatsAppProvider: WhatsAppProvider = {
  name: 'stub',
  async send(input: WhatsAppSendInput): Promise<WhatsAppSendResult> {
    stubLog.info(
      {
        target: input.to,
        templateName: input.template.name,
        language: input.template.language.code,
        componentCount: input.template.components?.length ?? 0,
      },
      'whatsapp_stub_send',
    );
    return { status: 'delivered', externalId: 'stub_whatsapp' };
  },
};
