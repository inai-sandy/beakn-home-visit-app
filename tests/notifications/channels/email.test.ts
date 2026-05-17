import { describe, expect, it, vi } from 'vitest';

// Mock lib/email BEFORE importing the adapter so the mock is captured.
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(async (input: { to: string; subject: string }) => {
    if (input.to === 'fail@example.com') {
      return { ok: false, error: 'simulated_smtp_failure' };
    }
    return { ok: true, messageId: `<msg-${input.subject.slice(0, 6)}@test>` };
  }),
}));

import { sendEmail } from '@/lib/email';
import { sendViaEmail } from '@/lib/notifications/channels/email';

const REAL_SEND_EMAIL = vi.mocked(sendEmail);

const baseContext = {
  requestId: '019e0000-0000-0000-0000-000000000001',
  customerName: 'Aarav',
  cityName: 'Bangalore',
  execUserId: '019e0000-0000-0000-0000-000000000002',
  execName: 'Veera',
  captainUserId: '019e0000-0000-0000-0000-000000000003',
  captainName: 'Arjun',
};

describe('sendViaEmail', () => {
  it('forwards composed body to lib/email + returns delivered on ok', async () => {
    REAL_SEND_EMAIL.mockClear();
    const result = await sendViaEmail({
      target: 'arjun@example.com',
      eventType: 'request.assigned',
      context: baseContext,
      templateKey: null,
    });
    expect(result.status).toBe('delivered');
    expect(result.externalId).toMatch(/^<msg-/u);
    expect(REAL_SEND_EMAIL).toHaveBeenCalledOnce();
    const arg = REAL_SEND_EMAIL.mock.calls[0]![0];
    expect(arg.to).toBe('arjun@example.com');
    expect(arg.subject).toBe('Assigned: Aarav — Bangalore');
    expect(arg.text).toContain('Veera');
    expect(arg.templateName).toBe('engine.request.assigned');
  });

  it('returns failed when lib/email returns ok=false', async () => {
    const result = await sendViaEmail({
      target: 'fail@example.com',
      eventType: 'request.assigned',
      context: baseContext,
      templateKey: null,
    });
    expect(result.status).toBe('failed');
    expect(result.error).toBe('simulated_smtp_failure');
  });

  it('returns failed when no composer registered for the event', async () => {
    const result = await sendViaEmail({
      target: 'x@example.com',
      eventType: 'no.such.event',
      context: {},
      templateKey: null,
    });
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/no_email_composer_for_no\.such\.event/u);
  });
});
