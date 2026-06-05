import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateDiscordWebhook } from '@/lib/admin/discord-webhook-validator';

// =============================================================================
// HVA-90: Discord webhook validator tests
// =============================================================================
//
// Mocks global fetch so we can drive the validator through every branch
// (shape reject, Discord 2xx, 4xx with message, 429, 5xx, timeout,
// network error).
// =============================================================================

const SAMPLE_WEBHOOK =
  'https://discord.com/api/webhooks/123456789012345678/abc-def_GHI_jkl';

const origFetch = globalThis.fetch;

beforeEach(() => {
  // Reset to a no-op so each test wires its own mock; tests that don't
  // assert fetch don't get cross-pollution.
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = origFetch;
});

describe('validateDiscordWebhook', () => {
  it('rejects empty input without hitting Discord', async () => {
    const res = await validateDiscordWebhook('   ');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/empty/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects non-Discord URLs by shape', async () => {
    const res = await validateDiscordWebhook(
      'https://hooks.slack.com/services/T000/B000/xxx',
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Discord webhook/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('accepts the discordapp.com legacy hostname', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 })) as unknown as typeof fetch;
    const res = await validateDiscordWebhook(
      'https://discordapp.com/api/webhooks/123456789012345678/abc',
    );
    expect(res.ok).toBe(true);
  });

  it('returns ok on Discord 2xx', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 })) as unknown as typeof fetch;
    const res = await validateDiscordWebhook(SAMPLE_WEBHOOK);
    expect(res.ok).toBe(true);
  });

  it('surfaces the Discord error message on 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ message: 'Invalid Webhook Token' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;
    const res = await validateDiscordWebhook(SAMPLE_WEBHOOK);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Invalid Webhook Token');
  });

  it('surfaces the Discord error message on 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ message: 'Unknown Webhook' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    ) as unknown as typeof fetch;
    const res = await validateDiscordWebhook(SAMPLE_WEBHOOK);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('Unknown Webhook');
  });

  it('returns rate-limit text on 429', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 429 })) as unknown as typeof fetch;
    const res = await validateDiscordWebhook(SAMPLE_WEBHOOK);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/rate-limited/i);
  });

  it('falls back to a generic message when Discord returns 500 with no body', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 500 })) as unknown as typeof fetch;
    const res = await validateDiscordWebhook(SAMPLE_WEBHOOK);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/500/);
  });

  it('treats AbortError as a timeout message', async () => {
    globalThis.fetch = vi.fn().mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    }) as unknown as typeof fetch;
    const res = await validateDiscordWebhook(SAMPLE_WEBHOOK);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/5 seconds/);
  });

  it('returns the underlying error message on other network failures', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const res = await validateDiscordWebhook(SAMPLE_WEBHOOK);
    expect(res.ok).toBe(false);
    expect(res.error).toBe('ECONNREFUSED');
  });
});
