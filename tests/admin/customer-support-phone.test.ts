import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/client';
import { auditLog, config } from '@/db/schema';
import { getConfig } from '@/lib/config';

let currentCookieHeader: string | undefined;
vi.mock('next/headers', () => ({
  headers: async () => {
    const h = new Headers();
    if (currentCookieHeader) h.set('cookie', currentCookieHeader);
    return h;
  },
  cookies: async () => ({ get: () => undefined }),
}));

import { PATCH } from '@/app/api/admin/config/customer-support-phone/route';

import { loginByPhone } from '../helpers/auth';
import { seedCaptain, seedExecutive, seedSuperAdmin } from '../helpers/db';

// =============================================================================
// HVA-105 (extended): PATCH /api/admin/config/customer-support-phone
// =============================================================================
//
// Schema reality verified:
//   - config.key='customer_support_phone' is NOT seeded by any migration —
//     scripts/seed-config.ts is run manually in prod. In the HVA-101 test
//     container the row doesn't exist on cold-start, so the route UPSERTs.
//   - config.value is jsonb; strings round-trip as JS strings.
//   - audit_log event_type='configuration_change' is in the allow-list
//     (HVA-91/92 migration 0006 + schema default). No new migration here.
//   - cache invalidation: not applicable post-HVA-112. lib/config carries
//     no in-memory cache; every getConfig hits Postgres. Tests just verify
//     the DB write + audit row + route response.
// =============================================================================

const KEY = 'customer_support_phone';

function buildReq(body: unknown): Request {
  return new Request(
    'https://visits.beakn.in/api/admin/config/customer-support-phone',
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
}

afterEach(async () => {
  // The HVA-101 harness's truncateAll() preserves `config` rows (they're
  // migration-seeded values + admin-tuned). Tests in this file mutate the
  // customer_support_phone row, so we DELETE it here — the route UPSERTs,
  // so absence is equivalent to a fresh test container's "no row" state.
  // (Same pollution shape that HVA-109 PR #41 fixed for cities columns.)
  await db.delete(config).where(eq(config.key, KEY));
});

describe('PATCH customer-support-phone: RBAC', () => {
  it('rejects anonymous with 401', async () => {
    currentCookieHeader = undefined;
    const res = await PATCH(buildReq({ value: '+919876543210' }));
    expect(res.status).toBe(401);
  });

  it('rejects captain with 403', async () => {
    const cap = await seedCaptain();
    const sess = await loginByPhone(cap.phone, cap.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await PATCH(buildReq({ value: '+919876543210' }));
    expect(res.status).toBe(403);
  });

  it('rejects sales_executive with 403', async () => {
    const cap = await seedCaptain();
    const exec = await seedExecutive(cap.id);
    const sess = await loginByPhone(exec.phone, exec.password);
    currentCookieHeader = sess.cookieHeader;
    const res = await PATCH(buildReq({ value: '+919876543210' }));
    expect(res.status).toBe(403);
  });
});

describe('PATCH customer-support-phone: happy path', () => {
  it('valid +91 + 10 digits → 200, value persisted, audit row written', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;

    const res = await PATCH(buildReq({ value: '+919876543210' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      value: string;
      changed: boolean;
    };
    expect(body.ok).toBe(true);
    expect(body.changed).toBe(true);
    expect(body.value).toBe('+919876543210');

    // DB row updated.
    const [row] = await db
      .select({ value: config.value })
      .from(config)
      .where(eq(config.key, KEY))
      .limit(1);
    expect(row.value).toBe('+919876543210');

    // getConfig sees the new value — no in-memory cache to invalidate
    // post-HVA-112; every read hits Postgres.
    const live = await getConfig('customer_support_phone');
    expect(live).toBe('+919876543210');

    // Audit row with the super_admin actor + before/after.
    // HVA-112 routes setConfig writes through lib/config, which records
    // beforeState as null when no prior row existed (previously the
    // direct-upsert path wrote `{ value: '' }`). Matches the standard
    // create-vs-update audit convention used elsewhere in the codebase.
    const audit = await db
      .select({
        eventType: auditLog.eventType,
        actorUserId: auditLog.actorUserId,
        actorRole: auditLog.actorRole,
        targetEntityType: auditLog.targetEntityType,
        targetEntityId: auditLog.targetEntityId,
        beforeState: auditLog.beforeState,
        afterState: auditLog.afterState,
      })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, KEY));
    expect(audit.length).toBe(1);
    expect(audit[0].eventType).toBe('configuration_change');
    expect(audit[0].actorUserId).toBe(sa.id);
    expect(audit[0].actorRole).toBe('super_admin');
    expect(audit[0].targetEntityType).toBe('config_key');
    expect(audit[0].beforeState).toBeNull();
    expect(audit[0].afterState).toMatchObject({ value: '+919876543210' });
  });

  it('blank value resets the row to "" + audit row', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;

    // Set first.
    await PATCH(buildReq({ value: '+919876543210' }));
    // Then blank.
    const res = await PATCH(buildReq({ value: '' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { value: string; changed: boolean };
    expect(body.value).toBe('');
    expect(body.changed).toBe(true);

    const live = await getConfig('customer_support_phone');
    expect(live).toBe('');

    // Two audit rows total (set + reset).
    const audit = await db
      .select({ afterState: auditLog.afterState })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, KEY));
    expect(audit.length).toBe(2);
  });

  it('no-op write (same value) → 200 changed:false, NO audit row written', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;

    // First write — produces 1 audit row.
    await PATCH(buildReq({ value: '+919876543210' }));
    // Same value again — short-circuit.
    const res = await PATCH(buildReq({ value: '+919876543210' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { changed: boolean };
    expect(body.changed).toBe(false);

    const audit = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.targetEntityId, KEY));
    expect(audit.length).toBe(1);
  });
});

describe('PATCH customer-support-phone: validation rejections', () => {
  // Each case validates one specific malformation path. The router never
  // mutates the row for invalid input — DB checked in the first case.
  const MALFORMED: Array<{ label: string; value: string }> = [
    { label: 'no +91 prefix', value: '9876543210' },
    { label: 'wrong country code', value: '+19876543210' },
    { label: '9 digits (1 short)', value: '+91987654321' },
    { label: 'trailing letter', value: '+919876543210x' },
    { label: 'leading space', value: '+91 9876543210' },
    { label: 'space in middle', value: '+919876 543210' },
  ];

  for (const { label, value } of MALFORMED) {
    it(`rejects "${label}" → 400 + fieldErrors.value names the requirement`, async () => {
      const sa = await seedSuperAdmin();
      const sess = await loginByPhone(sa.phone, sa.password);
      currentCookieHeader = sess.cookieHeader;

      const res = await PATCH(buildReq({ value }));
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        ok: boolean;
        fieldErrors?: Record<string, string>;
      };
      expect(body.ok).toBe(false);
      expect(body.fieldErrors?.value).toMatch(/\+91.*10 digits/i);

      // DB unchanged — no row inserted, no row updated.
      const [row] = await db
        .select({ value: config.value })
        .from(config)
        .where(eq(config.key, KEY))
        .limit(1);
      expect(row?.value ?? '').toBe('');
    });
  }

  it('rejects malformed JSON body → 400', async () => {
    const sa = await seedSuperAdmin();
    const sess = await loginByPhone(sa.phone, sa.password);
    currentCookieHeader = sess.cookieHeader;

    // Construct a Request with invalid JSON body.
    const badReq = new Request(
      'https://visits.beakn.in/api/admin/config/customer-support-phone',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '{not-json',
      },
    );
    const res = await PATCH(badReq);
    expect(res.status).toBe(400);
  });
});
