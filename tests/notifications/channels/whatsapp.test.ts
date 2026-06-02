import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendViaWhatsApp } from '@/lib/notifications/channels/whatsapp';
import { WHATSAPP_COMPOSERS } from '@/lib/notifications/compose/whatsapp-events';
import { _resetWhatsAppProviderForTests } from '@/lib/whatsapp';

// HVA-45 / HVA-49: WhatsApp channel adapter — composers are keyed by
// template_key, not event_type. Each test wipes the registry up-front
// so it doesn't depend on which production composers are registered.

// Snapshot the production composer registry so we can restore it after
// each test (the production registry is module-singleton and would be
// trashed by the wipe-and-rewrite pattern below if we didn't).
const PRODUCTION_REGISTRY_SNAPSHOT = { ...WHATSAPP_COMPOSERS };

function wipeRegistry() {
  for (const k of Object.keys(WHATSAPP_COMPOSERS)) delete WHATSAPP_COMPOSERS[k];
}

function restoreRegistry() {
  wipeRegistry();
  for (const [k, v] of Object.entries(PRODUCTION_REGISTRY_SNAPSHOT)) {
    WHATSAPP_COMPOSERS[k] = v;
  }
}

describe('sendViaWhatsApp', () => {
  const prevProvider = process.env.WHATSAPP_PROVIDER;
  const prevToken = process.env.LIBROMI_API_TOKEN;

  beforeEach(() => {
    _resetWhatsAppProviderForTests();
    delete process.env.LIBROMI_API_TOKEN;
    process.env.WHATSAPP_PROVIDER = 'stub';
    wipeRegistry();
  });

  afterEach(() => {
    _resetWhatsAppProviderForTests();
    if (prevProvider !== undefined) process.env.WHATSAPP_PROVIDER = prevProvider;
    else delete process.env.WHATSAPP_PROVIDER;
    if (prevToken !== undefined) process.env.LIBROMI_API_TOKEN = prevToken;
    else delete process.env.LIBROMI_API_TOKEN;
    restoreRegistry();
  });

  it('fails fast when the rule has no template_key (HVA-49)', async () => {
    const result = await sendViaWhatsApp({
      target: '+919876543210',
      eventType: 'request.assigned',
      context: {},
      templateKey: null,
    });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('no_template_key_for_request.assigned');
  });

  it('fails when no composer is registered for the template_key', async () => {
    const result = await sendViaWhatsApp({
      target: '+919876543210',
      eventType: 'request.assigned',
      context: {},
      templateKey: 'unknown_template',
    });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('no_whatsapp_composer_for_unknown_template');
  });

  it('delivers via stub provider when composer is registered', async () => {
    WHATSAPP_COMPOSERS['hello_world'] = () => ({
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
    WHATSAPP_COMPOSERS['hello_world'] = () => {
      throw new Error('missing context.requestId');
    };
    const result = await sendViaWhatsApp({
      target: '+919876543210',
      eventType: 'test.event',
      context: {},
      templateKey: 'hello_world',
    });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('composer_threw');
  });

  it('passes targetUserName through to the composer (HVA-49)', async () => {
    const seenArgs: { targetUserName?: string | null }[] = [];
    WHATSAPP_COMPOSERS['hello_world'] = (args) => {
      seenArgs.push({ targetUserName: args.targetUserName });
      return { name: 'hello_world', language: { code: 'en' } };
    };
    await sendViaWhatsApp({
      target: '+919876543210',
      eventType: 'request.assigned',
      context: {},
      templateKey: 'hello_world',
      targetUserName: 'Veera Kumar',
    });
    expect(seenArgs[0]?.targetUserName).toBe('Veera Kumar');
  });

  it('passes through provider failure as adapter failure', async () => {
    process.env.WHATSAPP_PROVIDER = 'libromi';
    // LIBROMI_API_TOKEN deliberately unset — config-missing path.
    _resetWhatsAppProviderForTests();
    WHATSAPP_COMPOSERS['hello_world'] = () => ({
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
    WHATSAPP_COMPOSERS['hello_world'] = () => ({
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
    WHATSAPP_COMPOSERS['hello_world'] = () => ({
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
      templateKey: 'hello_world',
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
    WHATSAPP_COMPOSERS['hello_world'] = () => ({
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
      templateKey: 'hello_world',
    });
    expect(result.status).toBe('delivered');
    expect(result.externalId).toBe('42');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(setTimeoutSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
    setTimeoutSpy.mockRestore();
  });
});

// =============================================================================
// HVA-49: smoke tests for the production composer registry — proves the
// composers exist, produce a body component with the correct number of
// param slots, and use targetUserName for the first-name field.
// =============================================================================

describe('production composer registry (HVA-49)', () => {
  // Snapshot then restore (the suite above wipes the registry per test).
  beforeEach(() => restoreRegistry());

  it('registers all 22 templates by template_key', () => {
    expect(Object.keys(WHATSAPP_COMPOSERS).sort()).toEqual(
      [
        // Customer-facing (8)
        'tracking_link_confirmation',
        'visit_scheduled',
        'visit_rescheduled',
        'quotation_ready',
        'order_confirmed',
        'installation_complete',
        'customer_cancellation_received',
        'we_had_to_cancel',
        // Internal — exec (10)
        'exec_request_assigned',
        'exec_visit_rescheduled',
        'exec_request_approved',
        'exec_request_rejected',
        'exec_day_close_reminder',
        'exec_request_reassigned_to_you',
        'exec_request_reassigned_off_you',
        'exec_customer_cancelled',
        'exec_assist_approved',
        'exec_assist_rejected',
        // Internal — captain (4)
        'captain_new_request',
        'captain_pending_approval',
        'captain_assist_request',
        // payment.received → captain (added 2026-06-02)
        'captain_payment_received',
      ].sort(),
    );
  });

  it('exec_request_assigned: 4 body params {execFirstName, customer, city, link}', () => {
    const composer = WHATSAPP_COMPOSERS['exec_request_assigned'];
    const out = composer({
      target: '+919876543210',
      context: {
        customerName: 'Anita',
        cityName: 'Bangalore',
        requestId: 'abc123',
      },
      templateKey: 'exec_request_assigned',
      targetUserName: 'Veera Kumar',
    });
    expect(out.name).toBe('exec_request_assigned');
    expect(out.language.code).toBe('en');
    const params = out.components![0]!.parameters!;
    expect(params).toHaveLength(4);
    expect(params[0]).toEqual({ type: 'text', text: 'Veera' });
    expect(params[1]).toEqual({ type: 'text', text: 'Anita' });
    expect(params[2]).toEqual({ type: 'text', text: 'Bangalore' });
    expect(params[3]).toEqual({
      type: 'text',
      text: 'https://visits.beakn.in/requests/abc123',
    });
  });

  it('exec_day_close_reminder: 2 body params {execFirstName, dayCloseLink}', () => {
    const composer = WHATSAPP_COMPOSERS['exec_day_close_reminder'];
    const out = composer({
      target: '+919876543210',
      context: {},
      templateKey: 'exec_day_close_reminder',
      targetUserName: 'Arjun Reddy',
    });
    const params = out.components![0]!.parameters!;
    expect(params).toHaveLength(2);
    expect(params[0]).toEqual({ type: 'text', text: 'Arjun' });
    expect(params[1]).toEqual({
      type: 'text',
      text: 'https://visits.beakn.in/today/close',
    });
  });

  it('exec_request_rejected: sanitises long reason text', () => {
    const composer = WHATSAPP_COMPOSERS['exec_request_rejected'];
    const longReason =
      'Quote pricing needs realignment with current bracket — please revise based on the updated rate card and resubmit';
    const out = composer({
      target: '+919876543210',
      context: {
        customerName: 'Anita',
        reason: longReason,
        requestId: 'abc123',
      },
      templateKey: 'exec_request_rejected',
      targetUserName: 'Veera',
    });
    const params = out.components![0]!.parameters!;
    const reasonParam = params[2] as { type: 'text'; text: string };
    expect(reasonParam.text.length).toBeLessThanOrEqual(60);
    expect(reasonParam.text.endsWith('…') || reasonParam.text === longReason).toBe(true);
  });

  it('falls back to "there" when targetUserName is missing', () => {
    const composer = WHATSAPP_COMPOSERS['exec_day_close_reminder'];
    const out = composer({
      target: '+919876543210',
      context: {},
      templateKey: 'exec_day_close_reminder',
      targetUserName: null,
    });
    const firstParam = out.components![0]!.parameters![0] as {
      type: 'text';
      text: string;
    };
    expect(firstParam.text).toBe('there');
  });
});
