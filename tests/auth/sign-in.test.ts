import { describe, expect, it } from 'vitest';

import { auth } from '@/lib/auth';

import { seedCaptain } from '../helpers/db';

// =============================================================================
// HVA-101 / Area 1: Better-Auth phone sign-in via auth.api.signInPhoneNumber
// =============================================================================
//
// signInPhoneNumber throws on failure (Better-Auth shape). We catch and
// inspect the thrown error's status to verify the happy / wrong-pw paths.
// Lockout is gated by the rate_limits table which truncateAll() wipes
// between tests.
// =============================================================================

describe('Better-Auth phone sign-in', () => {
  it('happy path: correct phone + password returns a session', async () => {
    const cap = await seedCaptain();
    const result = await auth.api.signInPhoneNumber({
      body: { phoneNumber: cap.phone, password: cap.password },
      returnHeaders: true,
    });
    expect(result.response).toBeDefined();
    if (result.response && 'token' in result.response) {
      expect(result.response.token).toMatch(/\S+/);
    }
  });

  it('wrong password is rejected', async () => {
    const cap = await seedCaptain();
    let threw: unknown = null;
    try {
      await auth.api.signInPhoneNumber({
        body: { phoneNumber: cap.phone, password: 'wrong-password-zzz' },
      });
    } catch (err) {
      threw = err;
    }
    expect(threw).not.toBeNull();
    // BA throws APIError with status 401 or similar; the message is the
    // BA-canonical INVALID_PHONE_NUMBER_OR_PASSWORD.
    expect(String(threw)).toMatch(/Invalid|password|phone/i);
  });

  it('unknown phone is rejected', async () => {
    let threw: unknown = null;
    try {
      await auth.api.signInPhoneNumber({
        body: { phoneNumber: '+910000000000', password: 'irrelevant' },
      });
    } catch (err) {
      threw = err;
    }
    expect(threw).not.toBeNull();
  });

  it('deactivated user cannot re-login even with correct password', async () => {
    // Regression: deactivation revoked existing sessions but nothing
    // blocked signing back in to mint a fresh one. The session.create
    // hook now rejects sign-in for isActive=false users.
    const cap = await seedCaptain({ isActive: false });
    let threw: unknown = null;
    try {
      await auth.api.signInPhoneNumber({
        body: { phoneNumber: cap.phone, password: cap.password },
      });
    } catch (err) {
      threw = err;
    }
    expect(threw).not.toBeNull();
    expect(String(threw)).toMatch(/deactivated/i);
  });
});
