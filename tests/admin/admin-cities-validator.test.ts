import { describe, expect, it } from 'vitest';

import {
  cityConfigUpdateSchema,
  cityRoutingEmailUpdateSchema,
} from '@/lib/validators/admin-cities';

// =============================================================================
// HVA-110 + HVA-90: validator tests
// =============================================================================
//
// HVA-110 schema (cityRoutingEmailUpdateSchema) — preserved for legacy
// callers. HVA-90 schema (cityConfigUpdateSchema) — multi-field, every
// field optional, '' normalised to null.
// =============================================================================

describe('cityRoutingEmailUpdateSchema (HVA-110 legacy)', () => {
  it('accepts a valid email', () => {
    const r = cityRoutingEmailUpdateSchema.safeParse({
      captainRoutingEmail: 'captain@example.com',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.captainRoutingEmail).toBe('captain@example.com');
    }
  });

  it('normalises empty string to null', () => {
    const r = cityRoutingEmailUpdateSchema.safeParse({
      captainRoutingEmail: '   ',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.captainRoutingEmail).toBe(null);
  });

  it('lowercases the email', () => {
    const r = cityRoutingEmailUpdateSchema.safeParse({
      captainRoutingEmail: 'Captain@Example.COM',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.captainRoutingEmail).toBe('captain@example.com');
  });

  it('rejects garbage', () => {
    const r = cityRoutingEmailUpdateSchema.safeParse({
      captainRoutingEmail: 'not-an-email',
    });
    expect(r.success).toBe(false);
  });
});

describe('cityConfigUpdateSchema (HVA-90 multi-field)', () => {
  it('accepts a partial payload with only captainRoutingEmail', () => {
    const r = cityConfigUpdateSchema.safeParse({
      captainRoutingEmail: 'admin@example.com',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.captainRoutingEmail).toBe('admin@example.com');
      expect(r.data.otherRoutingEmail).toBeUndefined();
      expect(r.data.discordWebhookUrl).toBeUndefined();
    }
  });

  it('accepts a partial payload with only discordWebhookUrl', () => {
    const r = cityConfigUpdateSchema.safeParse({
      discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.discordWebhookUrl).toBe(
        'https://discord.com/api/webhooks/123/abc',
      );
    }
  });

  it('accepts a full multi-field payload', () => {
    const r = cityConfigUpdateSchema.safeParse({
      captainRoutingEmail: 'cap@example.com',
      otherRoutingEmail: 'ops@example.com',
      discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
    });
    expect(r.success).toBe(true);
  });

  it('normalises empty strings to null per field', () => {
    const r = cityConfigUpdateSchema.safeParse({
      captainRoutingEmail: '',
      otherRoutingEmail: '   ',
      discordWebhookUrl: '',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.captainRoutingEmail).toBe(null);
      expect(r.data.otherRoutingEmail).toBe(null);
      expect(r.data.discordWebhookUrl).toBe(null);
    }
  });

  it('rejects malformed email', () => {
    const r = cityConfigUpdateSchema.safeParse({
      captainRoutingEmail: 'nope',
    });
    expect(r.success).toBe(false);
  });

  it('rejects malformed URL', () => {
    const r = cityConfigUpdateSchema.safeParse({
      discordWebhookUrl: 'not-a-url',
    });
    expect(r.success).toBe(false);
  });

  it('allows an empty body (no fields → caller decides what to do)', () => {
    const r = cityConfigUpdateSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.captainRoutingEmail).toBeUndefined();
      expect(r.data.otherRoutingEmail).toBeUndefined();
      expect(r.data.discordWebhookUrl).toBeUndefined();
    }
  });
});
