// Seed default rows into the `config` table for every key in CONFIG_SCHEMA.
// Idempotent: INSERT ... ON CONFLICT (key) DO NOTHING — re-running is safe and
// will only insert keys that don't already exist in the DB.
//
// Run from the host (or from any environment with network access to
// beakn-postgres). The host can't resolve `beakn-postgres:5432` (that hostname
// only exists inside mcp-network) so supply DATABASE_URL with the 127.0.0.1
// form:
//
//   DATABASE_URL=postgresql://beakn_app:PW@127.0.0.1:5432/beakn_app \
//     pnpm db:seed:config
//
// Adds a new key in CONFIG_SCHEMA? Run this script again.
//
// Why this script connects directly instead of importing `db/client.ts`:
// Node's native ESM resolver (used by --experimental-strip-types) doesn't
// auto-resolve bare directory imports like `from './schema'`. Inlining the
// drizzle setup keeps the seed self-contained and avoids changing
// app-runtime import paths just to satisfy the script.

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { config as configTable } from '../db/schema/config';
import { CONFIG_SCHEMA } from '../lib/config-schema';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. From the host run:\n' +
        '  DATABASE_URL=postgresql://beakn_app:PW@127.0.0.1:5432/beakn_app pnpm db:seed:config',
    );
  }

  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(client, { casing: 'snake_case' });

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
      console.log(`[seed:config] + ${key}`);
    } else {
      skipped += 1;
    }
  }
  console.log(
    `[seed:config] done. inserted=${inserted}  already-present=${skipped}  total=${
      inserted + skipped
    }`,
  );

  await client.end();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed:config] failed:', err);
    process.exit(1);
  });
