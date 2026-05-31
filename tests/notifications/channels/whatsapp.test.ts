import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendViaWhatsApp } from '@/lib/notifications/channels/whatsapp';
import { WHATSAPP_COMPOSERS } from '@/lib/notifications/compose/whatsapp-events';
import { _resetWhatsAppProviderForTests } from '@/lib/whatsapp';

// HVA-45: WhatsApp channel adapter — now delegates to the provider.
// The adapter looks up a composer per event; if none registered, the
// dispatch fails (was previously silently delivered by the stub).

describe('sendViaWhatsApp', () => {
  const prevProvider = process.env.WHATSAPP_PROVIDER;
  const prevToken = process.env.LIBROMI_API_TOKEN;

  beforeEach(() => {
    _resetWhatsAppProviderForTests();
    delete process.env.LIBROMI_API_TOKEN;
    process.env.WHATSAPP_PROVIDER = 'stub';
    // Wipe any composer registrations from prior tests.
    for (const k of Object.keys(WHATSAPP_COMPOSERS)) delete WHATSAPP_COMPOSERS[k];
  });

  afterEach(() => {
    _resetWhatsAppProviderForTests();
    if (prevProvider !== undefined) process.env.WHATSAPP_PROVIDER = prevProvider;
    else delete process.env.WHATSAPP_PROVIDER;
    if (prevToken !== undefined) process.env.LIBROMI_API_TOKEN = prevToken;
    else delete process.env.LIBROMI_API_TOKEN;
    for (const k of Object.keys(WHATSAPP_COMPOSERS)) delete WHATSAPP_COMPOSERS[k];
  });

  it('fails when no composer is registered for the event', async () => {
    const result = await sendViaWhatsApp({
      target: '+919876543210',
      eventType: 'request.assigned',
      context: {},
      templateKey: null,
    });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('no_whatsapp_composer_for_request.assigned');
  });

  it('delivers via stub provider when composer is registered', async () => {
    WHATSAPP_COMPOSERS['test.event'] = () => ({
      name: 'hello_world',
      language: { code: 'en_US' },
    });
    const result = await sendViaWhatsApp({
      target: '+919876543210',
      eventType: 'test.event',
      context: {},
      templateKey: 'hello_world',
    });
    expect(result.status).toBe('delivered');
    expect(result.externalId).toBe('stub_whatsapp');
  });

  it('fails when composer throws', async () => {
    WHATSAPP_COMPOSERS['test.event'] = () => {
      throw new Error('missing context.requestId');
    };
    const result = await sendViaWhatsApp({
      target: '+919876543210',
      eventType: 'test.event',
      context: {},
      templateKey: null,
    });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('composer_threw');
  });

  it('passes through provider failure as adapter failure', async () => {
    process.env.WHATSAPP_PROVIDER = 'libromi';
    // LIBROMI_API_TOKEN deliberately unset — config-missing path.
    _resetWhatsAppProviderForTests();
    WHATSAPP_COMPOSERS['test.event'] = () => ({
      name: 'hello_world',
      language: { code: 'en_US' },
    });
    const result = await sendViaWhatsApp({
      target: '+919876543210',
      eventType: 'test.event',
      context: {},
      templateKey: 'hello_world',
    });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('LIBROMI_API_TOKEN');
  });

  it('libromi provider: success returns externalId from messageId', async () => {
    process.env.WHATSAPP_PROVIDER = 'libromi';
    process.env.LIBROMI_API_TOKEN = 'test_token_abc';
    process.env.LIBROMI_FROM_PHONE = '+919539911523';
    _resetWhatsAppProviderForTests();
    WHATSAPP_COMPOSERS['test.event'] = () => ({
      name: 'hello_world',
      language: { code: 'en_US' },
    });

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: 'SUCCESS', messageId: 99999 }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await sendViaWhatsApp({
      target: '+919876543210',
      eventType: 'test.event',
      context: {},
      templateKey: 'hello_world',
    });
    expect(result.status).toBe('delivered');
    expect(result.externalId).toBe('99999');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://wa-api.cloud/api/v1/messages');
    expect((opts as RequestInit).method).toBe('POST');
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.to).toBe('+919876543210');
    expect(body.type).toBe('template');
    expect(body.template.name).toBe('hello_world');
    expect(body.from).toBe('+919539911523');
    fetchSpy.mockRestore();
  });

  it('libromi provider: permanent error (401) fails immediately', async () => {
    process.env.WHATSAPP_PROVIDER = 'libromi';
    process.env.LIBROMI_API_TOKEN = 'bad_token';
    _resetWhatsAppProviderForTests();
    WHATSAPP_COMPOSERS['test.event'] = () => ({
      name: 'hello_world',
      language: { code: 'en_US' },
    });

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 'FAILED',
          message: 'Unauthenticated',
          error_code: 'UNAUTHENTICATED',
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await sendViaWhatsApp({
      target: '+919876543210',
      eventType: 'test.event',
      context: {},
      templateKey: null,
    });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('UNAUTHENTICATED');
    expect(fetchSpy).toHaveBeenCalledTimes(1); // no retry on permanent
    fetchSpy.mockRestore();
  });

  it('libromi provider: 429 retries and recovers on success', async () => {
    process.env.WHATSAPP_PROVIDER = 'libromi';
    process.env.LIBROMI_API_TOKEN = 'test_token';
    _resetWhatsAppProviderForTests();
    WHATSAPP_COMPOSERS['test.event'] = () => ({
      name: 'hello_world',
      language: { code: 'en_US' },
    });

    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'FAILED',
            message: 'rate limit',
            error_code: 'RATE_LIMIT_EXCEEDED',
            retry_after_seconds: 1,
          }),
          { status: 429, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ status: 'SUCCESS', messageId: 42 }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    // Stub setTimeout so the 1s wait between attempts doesn't actually
    // delay the test.
    const setTimeoutSpy = vi
      .spyOn(global, 'setTimeout')
      .mockImplementation(((cb: () => void) => {
        cb();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout);

    const result = await sendViaWhatsApp({
      target: '+919876543210',
      eventType: 'test.event',
      context: {},
      templateKey: null,
    });
    expect(result.status).toBe('delivered');
    expect(result.externalId).toBe('42');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(setTimeoutSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
    setTimeoutSpy.mockRestore();
  });
});
