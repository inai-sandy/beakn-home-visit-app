import { describe, expect, it } from 'vitest';

import { sendViaDiscord } from '@/lib/notifications/channels/discord';

describe('sendViaDiscord (stub)', () => {
  it('returns delivered without throwing — HVA-43 will swap the implementation', async () => {
    const result = await sendViaDiscord({
      target: '019e0000-0000-0000-0000-000000000001',
      eventType: 'request.assigned',
      context: { requestId: '019e0000-0000-0000-0000-000000000001' },
      templateKey: null,
    });
    expect(result.status).toBe('delivered');
    expect(result.externalId).toBe('stub_discord');
  });
});
