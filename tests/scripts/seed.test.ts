import { hashPassword } from 'better-auth/crypto';
import { eq, sql as sqlBuilder } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { accounts, cities, config, statusStages, users } from '@/db/schema';
import { CONFIG_SCHEMA } from '@/lib/config-schema';

import { runSeed } from '../../scripts/seed';

// =============================================================================
// HVA-96: seed script behaviour
// =============================================================================
//
// The harness preserves cities + status_stages + config between tests (those
// rows are migration seeds / shared bootstrap). users is wiped via DELETE in
// the afterEach. We run `runSeed(db)` against the live testcontainer-backed
// drizzle and assert outcomes.
//
// Config note: the testcontainer applies migrations only; CONFIG_SCHEMA rows
// are NOT auto-seeded by the harness. The first runSeed() call inserts the
// 11 config rows; later calls are no-ops thanks to ON CONFLICT DO NOTHING.
// Across test files within a single `vitest run`, the rows persist (truncate
// list excludes config), which is fine — every test asserting on config does
// so under "after runSeed".
// =============================================================================

const SANDEEP_PHONE = '+919885698665';
const CONFIG_KEY_COUNT = Object.keys(CONFIG_SCHEMA).length; // 11 as of writing

async function countRows(table: typeof users | typeof cities | typeof config | typeof statusStages): Promise<number> {
  const [{ c }] = await db
    .select({ c: sqlBuilder<number>`count(*)::int` })
    .from(table);
  return c;
}

async function deleteSandeep(): Promise<void> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phone, SANDEEP_PHONE));
  for (const row of rows) {
    await db.delete(accounts).where(eq(accounts.userId, row.id));
    await db.delete(users).where(eq(users.id, row.id));
  }
}

// runSeed prints to stdout (operator-facing). Tests don't care about the
// output content — return value carries the temp password. Silence stdout so
// the test runner output isn't drowned in banners.
let stdoutWrite: typeof process.stdout.write;
beforeEach(() => {
  stdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
});

// Clean up the config + super_admin rows this file inserts. The harness's
// truncateAll preserves config between tests (other suites — tests/lib/
// config.test.ts in particular — rely on starting from an empty config
// table for the keys they exercise). Without this afterEach, this file
// poisons config for downstream suites with a PK conflict on insert.
afterEach(async () => {
  process.stdout.write = stdoutWrite;
  await deleteSandeep();
  await db.delete(config);
});

describe('scripts/seed.ts — runSeed', () => {
  it('fresh DB: verifies cities + status_stages and inserts config + super_admin', async () => {
    await deleteSandeep();

    const result = await runSeed(db);

    expect(await countRows(cities)).toBeGreaterThanOrEqual(9);
    expect(await countRows(statusStages)).toBeGreaterThanOrEqual(10);
    expect(await countRows(config)).toBe(CONFIG_KEY_COUNT);

    const sandeep = await db
      .select({
        id: users.id,
        role: users.role,
        phone: users.phone,
        mustChangePassword: users.mustChangePassword,
      })
      .from(users)
      .where(eq(users.phone, SANDEEP_PHONE))
      .limit(1);
    expect(sandeep).toHaveLength(1);
    expect(sandeep[0].role).toBe('super_admin');
    expect(typeof result.superAdminTempPassword).toBe('string');
    expect(result.superAdminTempPassword).toMatch(/^[0-9a-f]{16}$/);

    const acct = await db
      .select({ password: accounts.password, providerId: accounts.providerId })
      .from(accounts)
      .where(eq(accounts.userId, sandeep[0].id));
    expect(acct).toHaveLength(1);
    expect(acct[0].providerId).toBe('credential');
    expect(acct[0].password).not.toBeNull();
    expect(acct[0].password).not.toBe(result.superAdminTempPassword); // hashed, not plaintext
  });

  it('re-running on a populated DB is a no-op', async () => {
    await deleteSandeep();
    const first = await runSeed(db);
    expect(first.superAdminTempPassword).not.toBeNull();

    const usersBefore = await countRows(users);
    const configBefore = await countRows(config);
    const citiesBefore = await countRows(cities);
    const stagesBefore = await countRows(statusStages);

    const second = await runSeed(db);
    expect(second.superAdminTempPassword).toBeNull();

    expect(await countRows(users)).toBe(usersBefore);
    expect(await countRows(config)).toBe(configBefore);
    expect(await countRows(cities)).toBe(citiesBefore);
    expect(await countRows(statusStages)).toBe(stagesBefore);
  });

  it('pre-populated super_admin: existence-check skips the insert', async () => {
    await deleteSandeep();
    // Manually pre-populate Sandeep with a different password than the seed
    // would generate. Existence-check should leave this row untouched.
    const preExistingPassword = await hashPassword('pre-existing-password-zzz');
    const [created] = await db
      .insert(users)
      .values({
        role: 'super_admin',
        fullName: 'Sandeep Karnati',
        phone: SANDEEP_PHONE,
        email: 'sandy@beakn.in',
        emailVerified: false,
        phoneVerified: true,
        isActive: true,
        mustChangePassword: false, // deliberately false — seed would set true
      })
      .returning();
    await db.insert(accounts).values({
      accountId: created.id,
      providerId: 'credential',
      userId: created.id,
      password: preExistingPassword,
    });

    const usersBefore = await countRows(users);

    const result = await runSeed(db);
    expect(result.superAdminTempPassword).toBeNull();

    expect(await countRows(users)).toBe(usersBefore);
    const sandeep = await db
      .select({ mustChangePassword: users.mustChangePassword })
      .from(users)
      .where(eq(users.phone, SANDEEP_PHONE))
      .limit(1);
    // Confirm the pre-existing must_change_password=false was preserved
    // (proves the seed did not overwrite the row).
    expect(sandeep[0].mustChangePassword).toBe(false);
    const acct = await db
      .select({ password: accounts.password })
      .from(accounts)
      .where(eq(accounts.userId, created.id))
      .limit(1);
    expect(acct[0].password).toBe(preExistingPassword);
  });

  it('temp password is non-deterministic across runs', async () => {
    await deleteSandeep();
    const first = await runSeed(db);

    await deleteSandeep();
    const second = await runSeed(db);

    expect(first.superAdminTempPassword).not.toBeNull();
    expect(second.superAdminTempPassword).not.toBeNull();
    expect(first.superAdminTempPassword).not.toBe(second.superAdminTempPassword);
  });

  it('freshly-seeded super_admin has must_change_password = true', async () => {
    await deleteSandeep();
    await runSeed(db);
    const [sandeep] = await db
      .select({ mustChangePassword: users.mustChangePassword })
      .from(users)
      .where(eq(users.phone, SANDEEP_PHONE))
      .limit(1);
    expect(sandeep.mustChangePassword).toBe(true);
  });
});
