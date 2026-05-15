// Seed a single super_admin user for HVA-24-style end-to-end verification.
//
// CREDENTIAL HYGIENE: this script never embeds credentials in the source.
// Pass them via env vars at invocation time:
//
//   TEST_ADMIN_PHONE="+91XXXXXXXXXX" \
//   TEST_ADMIN_PASSWORD="<choose-one>" \
//   DATABASE_URL=postgresql://beakn_app:PW@127.0.0.1:5432/beakn_app \
//     pnpm db:seed:test-admin
//
// Both env vars are REQUIRED — the script refuses to run without them.
// No defaults, no fallbacks. The whole point of moving them out of the
// file is to keep test strings off `git log` and out of the repo. Pick
// throwaway values, run the verification, then delete the user:
//
//   docker exec beakn-postgres psql -U beakn_app -d beakn_app \
//     -c "DELETE FROM users WHERE phone='+91XXXXXXXXXX';"
//
// The first real super_admin is seeded in HVA-96 (the city/admin seed),
// not here. This script is for ad-hoc verification only.
//
// The script uses Better-Auth's `hashPassword` (scrypt) directly so the
// resulting hash is verifiable by BA's signIn endpoint.
//
// Idempotent: re-running drops the existing target user's session +
// account rows first, then recreates them with a fresh hash.

import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { accounts } from '../db/schema/accounts';
import { users } from '../db/schema/auth';
import { sessions } from '../db/schema/sessions';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(
      `${name} is not set. This script requires credentials via env vars only —\n` +
        'no defaults, no fallbacks. Invoke with:\n' +
        '  TEST_ADMIN_PHONE="+91XXXXXXXXXX" \\\n' +
        '  TEST_ADMIN_PASSWORD="<choose-one>" \\\n' +
        '  DATABASE_URL=postgresql://beakn_app:PW@127.0.0.1:5432/beakn_app \\\n' +
        '    pnpm db:seed:test-admin',
    );
  }
  return v;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. From the host:\n' +
        '  DATABASE_URL=postgresql://beakn_app:PW@127.0.0.1:5432/beakn_app pnpm db:seed:test-admin',
    );
  }

  const phone = requireEnv('TEST_ADMIN_PHONE');
  const plaintextPassword = requireEnv('TEST_ADMIN_PASSWORD');

  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(client, { casing: 'snake_case' });

  // Clean slate for the target phone — drop any prior session + account
  // rows, then the user itself.
  const existing = await db.select().from(users).where(eq(users.phone, phone)).limit(1);
  if (existing.length > 0) {
    const id = existing[0].id;
    await db.delete(sessions).where(eq(sessions.userId, id));
    await db.delete(accounts).where(eq(accounts.userId, id));
    await db.delete(users).where(eq(users.id, id));
    console.log(`[seed:test-admin] removed existing user ${id}`);
  }

  const password = await hashPassword(plaintextPassword);

  const [created] = await db
    .insert(users)
    .values({
      role: 'super_admin',
      fullName: 'Test Super Admin',
      phone,
      email: null,
      emailVerified: false,
      phoneVerified: true,
      isActive: true,
      mustChangePassword: false,
    })
    .returning();

  await db.insert(accounts).values({
    accountId: created.id,
    providerId: 'credential',
    userId: created.id,
    password,
  });

  // Echo only the user id + a phone digit count — never echo the
  // password or the full phone string back to stdout. If the operator
  // needs to remember the phone, they passed it in themselves.
  console.log(`[seed:test-admin] created user ${created.id} role=super_admin`);
  console.log(`[seed:test-admin] phone digits seeded: ${phone.length}`);
  console.log(`[seed:test-admin] mustChangePassword=false`);
  console.log('[seed:test-admin] DELETE THIS USER AFTER YOUR VERIFICATION RUN.');

  await client.end();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed:test-admin] failed:', err.message ?? err);
    process.exit(1);
  });
