// =============================================================================
// HVA-96 — Production seed: umbrella verifier + first super_admin bootstrap
// =============================================================================
//
// Run once on a fresh production DB after `pnpm db:migrate`:
//
//   DATABASE_URL=postgresql://beakn_app:PW@127.0.0.1:5432/beakn_app pnpm db:seed
//
// Idempotent: re-running on a populated DB is a no-op. Every step is either
// a verifier (read-only, errors only if a migration-owned seed is missing) or
// an existence-check-then-insert.
//
// Does NOT run automatically on deploy (HVA-126 territory).
// Does NOT seed notification_rules (HVA-50 owns it).
// Does NOT seed outcome_options / postpone_reasons — Phase 2 tables with no
// canonical defaults yet.
// Does NOT re-seed cities or status_stages — migrations 0004 + 0005 own them.
//   This script verifies those tables are populated and ERRORS LOUDLY if not,
//   because empty cities/status_stages means migrations didn't run (deploy bug,
//   not a seed bug).
//
// What this script does insert:
//   1. config rows from CONFIG_SCHEMA defaults (ON CONFLICT (key) DO NOTHING).
//      11 keys; prod already has all of them via scripts/seed-config.ts.
//   2. The first super_admin user (Sandeep Karnati / +919885698665) if and only
//      if no row exists for that phone. Generates a 16-char hex temp password
//      printed to stdout EXACTLY TWICE (once before, once after the work) so
//      a deploy operator who blinks doesn't miss it.
//
// Super-admin insert pattern is a direct port of scripts/seed-test-admin.ts:
//   - INSERT INTO users (...)
//   - INSERT INTO accounts (account_id, provider_id='credential', user_id,
//     password=hashPassword(plaintext))
//   - hashPassword from 'better-auth/crypto' is scrypt (BA default; deviation
//     #2 documented in lib/auth.ts).
//
// Connection: postgres-js + drizzle inline. Same self-contained pattern as
// scripts/seed-config.ts and scripts/seed-test-admin.ts — does NOT use
// db/client.ts to avoid the ESM bare-directory-import friction under tsx
// --experimental-strip-types.
// =============================================================================

import { randomBytes } from 'node:crypto';

import { hashPassword } from 'better-auth/crypto';
import { eq, sql as sqlBuilder } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { accounts } from '../db/schema/accounts';
import { users } from '../db/schema/auth';
import { config as configTable } from '../db/schema/config';
import { cities, statusStages } from '../db/schema';
import { CONFIG_SCHEMA } from '../lib/config-schema';

const SANDEEP_PHONE = '+919885698665';
const SANDEEP_NAME = 'Sandeep Karnati';
const SANDEEP_EMAIL = 'sandy@beakn.in';

type Drizzle = ReturnType<typeof drizzle>;

// -----------------------------------------------------------------------------
// Verifiers: cities + status_stages must be populated by migrations 0004/0005.
// COUNT == 0 means migrations didn't run — that's a deploy failure, not a
// seed-script bug. Exit non-zero so the operator notices.
// -----------------------------------------------------------------------------
async function verifyCities(db: Drizzle): Promise<void> {
  const [{ count }] = await db
    .select({ count: sqlBuilder<number>`count(*)::int` })
    .from(cities);
  if (count === 0) {
    throw new Error(
      'cities table is EMPTY. Migration 0004_hva33_seed_phase1_cities_status_stages.sql ' +
        'did not run. Run `pnpm db:migrate` first. seed.ts will NOT insert cities ' +
        'because that data is migration-owned.',
    );
  }
  console.log(`[seed] cities verified: ${count} rows present (migration-owned). skip.`);
}

async function verifyStatusStages(db: Drizzle): Promise<void> {
  const [{ count }] = await db
    .select({ count: sqlBuilder<number>`count(*)::int` })
    .from(statusStages);
  if (count === 0) {
    throw new Error(
      'status_stages table is EMPTY. Migrations 0004 + 0005 did not run. Run ' +
        '`pnpm db:migrate` first. seed.ts will NOT insert status_stages because ' +
        'that data is migration-owned.',
    );
  }
  console.log(
    `[seed] status_stages verified: ${count} rows present (migration-owned). skip.`,
  );
}

// -----------------------------------------------------------------------------
// Config: insert defaults from CONFIG_SCHEMA. ON CONFLICT (key) DO NOTHING.
// Mirrors scripts/seed-config.ts so a single `pnpm db:seed` covers both.
// -----------------------------------------------------------------------------
async function seedConfig(db: Drizzle): Promise<void> {
  let inserted = 0;
  let skipped = 0;
  for (const [key, def] of Object.entries(CONFIG_SCHEMA)) {
    const result = await db
      .insert(configTable)
      .values({
        key,
        category: def.category,
        value: def.defaultValue as unknown,
        description: def.description,
      })
      .onConflictDoNothing()
      .returning({ key: configTable.key });
    if (result.length > 0) {
      inserted += 1;
      console.log(`[seed] config + ${key}`);
    } else {
      skipped += 1;
    }
  }
  console.log(`[seed] config done. inserted=${inserted} already-present=${skipped}`);
}

// -----------------------------------------------------------------------------
// First super_admin (Sandeep). Existence-check on phone — already-present is a
// no-op. Direct port of scripts/seed-test-admin.ts's users+accounts insert.
// -----------------------------------------------------------------------------
// Returns the freshly-minted temp password, or null if the row already existed
// (skip path). Tests assert on the return value; stdout is for operators.
async function seedSuperAdmin(db: Drizzle): Promise<string | null> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.phone, SANDEEP_PHONE))
    .limit(1);
  if (existing.length > 0) {
    console.log('[seed] super_admin Sandeep already exists, skipping.');
    return null;
  }

  // 16-char hex (8 random bytes). Printed twice with banner separators so
  // deploy-log scroll doesn't bury it.
  const tempPassword = randomBytes(8).toString('hex');
  const passwordHash = await hashPassword(tempPassword);

  console.log('');
  console.log('================================================================');
  console.log('[seed] super_admin TEMP PASSWORD (write this down NOW):');
  console.log(`[seed]   phone: ${SANDEEP_PHONE}`);
  console.log(`[seed]   temp:  ${tempPassword}`);
  console.log('================================================================');
  console.log('');

  const [created] = await db
    .insert(users)
    .values({
      role: 'super_admin',
      fullName: SANDEEP_NAME,
      phone: SANDEEP_PHONE,
      email: SANDEEP_EMAIL,
      emailVerified: false,
      phoneVerified: true,
      isActive: true,
      mustChangePassword: true,
    })
    .returning();

  await db.insert(accounts).values({
    accountId: created.id,
    providerId: 'credential',
    userId: created.id,
    password: passwordHash,
  });

  console.log(`[seed] super_admin created: user_id=${created.id}`);
  console.log('');
  console.log('================================================================');
  console.log('[seed] LAST CHANCE — write the temp password down:');
  console.log(`[seed]   phone: ${SANDEEP_PHONE}`);
  console.log(`[seed]   temp:  ${tempPassword}`);
  console.log('[seed] First login will force a password change.');
  console.log('================================================================');
  console.log('');

  return tempPassword;
}

// -----------------------------------------------------------------------------
// Phase 2 tables (outcome_options, postpone_reasons): skipped intentionally.
// No canonical defaults exist in code yet. They will be owned by the issue
// that ships the Phase 2 lead/task UI.
// -----------------------------------------------------------------------------

export interface SeedResult {
  /** The freshly-minted temp password, or null if the super_admin row already existed. */
  superAdminTempPassword: string | null;
}

export async function runSeed(db: Drizzle): Promise<SeedResult> {
  console.log('[seed] Starting HVA-96 seed…');
  await verifyCities(db);
  await verifyStatusStages(db);
  await seedConfig(db);
  const superAdminTempPassword = await seedSuperAdmin(db);
  console.log('[seed] (skip) outcome_options + postpone_reasons — Phase 2, no defaults.');
  console.log('[seed] (skip) notification_rules — HVA-50 owns it.');
  console.log('[seed] Done.');
  return { superAdminTempPassword };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. From the host:\n' +
        '  DATABASE_URL=postgresql://beakn_app:PW@127.0.0.1:5432/beakn_app pnpm db:seed',
    );
  }
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(client, { casing: 'snake_case' });
  try {
    await runSeed(db);
  } finally {
    await client.end({ timeout: 5 });
  }
}

// Run only when invoked as a script — tests import { runSeed } and provide
// their own drizzle instance against the testcontainer DB.
const invokedAsScript =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('/scripts/seed.ts') ||
    process.argv[1].endsWith('\\scripts\\seed.ts'));

if (invokedAsScript) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[seed] FAILED: ${msg}`);
      process.exit(1);
    });
}
