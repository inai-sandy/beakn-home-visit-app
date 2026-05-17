import { describe, expect, it } from 'vitest';

import { sendViaWhatsApp } from '@/lib/notifications/channels/whatsapp';

describe('sendViaWhatsApp (stub)', () => {
  it('returns delivered without throwing — HVA-49 will swap the implementation', async () => {
    const result = await sendViaWhatsApp({
      target: '+919876543210',
      eventType: 'request.assigned',
      context: { requestId: '019e0000-0000-0000-0000-000000000001' },
      templateKey: null,
    });
    expect(result.status).toBe('delivered');
    expect(result.externalId).toBe('stub_whatsapp');
  });
});
