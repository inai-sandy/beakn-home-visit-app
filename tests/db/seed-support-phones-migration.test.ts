import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { eq, inArray, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { db } from '@/db/client';
import { config } from '@/db/schema';

// =============================================================================
// Migration 0081 — seed customer_support_phone + admin_support_phone
// =============================================================================
//
// Same rationale as tests/db/notification-wiring-migration.test.ts: we exercise
// the migration file's SQL directly rather than asserting on live post-migrate
// state (which is order-dependent across the suite after truncateAll). The SQL
// is idempotent by design (INSERT ... ON CONFLICT (key) DO NOTHING), and this
// verifies the actual keys, category, and JSON-encoded values it seeds.
// =============================================================================

const MIGRATION_PATH = join(
  process.cwd(),
  'db',
  'migrations',
  '0081_seed_support_phones.sql',
);

const KEYS = ['customer_support_phone', 'admin_support_phone'] as const;
const PHONE = '+919701278976';

function readMigration(): string {
  // Pre-fix: this file did not exist — readFileSync throws ENOENT and the
  // test fails before any assertion runs.
  return readFileSync(MIGRATION_PATH, 'utf8');
}

async function clearKeys(): Promise<void> {
  await db.delete(config).where(inArray(config.key, [...KEYS]));
}

describe('db/migrations/0081_seed_support_phones.sql', () => {
  it('seeds BOTH support-phone keys with the real number, JSON-decoded to a plain string', async () => {
    await clearKeys();
    const migrationSql = readMigration();

    await db.execute(sql.raw(migrationSql));

    const rows = await db
      .select({
        key: config.key,
        value: config.value,
        category: config.category,
      })
      .from(config)
      .where(inArray(config.key, [...KEYS]));

    expect(rows).toHaveLength(2);
    const byKey = new Map(rows.map((r) => [r.key, r]));

    for (const key of KEYS) {
      const row = byKey.get(key);
      expect(row, `expected config row for ${key}`).toBeDefined();
      // JSONB stored as a JSON string → Drizzle decodes to a plain string.
      expect(row!.value).toBe(PHONE);
      expect(row!.category).toBe('organization');
    }
  });

  it('is idempotent and never overwrites an admin-tuned value', async () => {
    await clearKeys();
    const migrationSql = readMigration();

    // Admin has already set a different customer number.
    await db.insert(config).values({
      key: 'customer_support_phone',
      category: 'organization',
      value: '+911111111111',
    });

    // Run twice — ON CONFLICT DO NOTHING must not throw and must not clobber.
    await db.execute(sql.raw(migrationSql));
    await db.execute(sql.raw(migrationSql));

    const [customer] = await db
      .select({ value: config.value })
      .from(config)
      .where(eq(config.key, 'customer_support_phone'));
    // Admin value preserved.
    expect(customer!.value).toBe('+911111111111');

    // The not-yet-set key was still seeded.
    const [admin] = await db
      .select({ value: config.value })
      .from(config)
      .where(eq(config.key, 'admin_support_phone'));
    expect(admin!.value).toBe(PHONE);
  });
});
